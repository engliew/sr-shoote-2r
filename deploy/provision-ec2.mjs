#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EC2Client,
  CreateKeyPairCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  DescribeImagesCommand,
  DescribeInstancesCommand,
  DescribeKeyPairsCommand,
  DescribeSecurityGroupsCommand,
  DescribeVpcsCommand,
  RunInstancesCommand,
} from '@aws-sdk/client-ec2';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = dirname(__dirname);
const DEPLOY_ENV = join(__dirname, '.deploy-env');

const AWS_REGION = process.env.AWS_REGION || 'ap-southeast-1';
const INSTANCE_TYPE = process.env.INSTANCE_TYPE || 't3.micro';
const KEY_NAME = process.env.KEY_NAME || 'sr-shoote-2r-key';
const SG_NAME = process.env.SG_NAME || 'sr-shoote-2r-sg';
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'sr-shoote-2r';
const APP_PORT = process.env.PORT || '3850';

// Reuse existing instance if REDEPLOY=1 and .deploy-env exists
const REDEPLOY = process.env.REDEPLOY === '1' || process.argv.includes('--redeploy');

const ec2 = new EC2Client({ region: AWS_REGION });
const sts = new STSClient({ region: AWS_REGION });

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
}

function loadEnvFile() {
  if (!existsSync(DEPLOY_ENV)) return {};
  const out = {};
  for (const line of readFileSync(DEPLOY_ENV, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function waitSsh(keyFile, publicIp) {
  console.log(`==> Waiting for SSH (${publicIp})...`);
  for (let i = 1; i <= 36; i++) {
    const result = spawnSync(
      'ssh',
      [
        '-o',
        'StrictHostKeyChecking=no',
        '-o',
        'UserKnownHostsFile=/dev/null',
        '-o',
        'ConnectTimeout=5',
        '-i',
        keyFile,
        `ec2-user@${publicIp}`,
        'echo ready',
      ],
      { encoding: 'utf8' }
    );
    if (result.status === 0) {
      console.log('SSH ready');
      return;
    }
    process.stdout.write(`.`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw new Error('SSH not ready after waiting');
}

async function packageAndInstall(keyFile, publicIp) {
  const tarball = join(__dirname, 'sr-shoote-2r-deploy.tar.gz');
  console.log('==> Packaging app...');
  run(
    `tar -czf "${tarball}" --exclude='node_modules' --exclude='.git' --exclude='deploy/node_modules' --exclude='deploy/*.tar.gz' --exclude='deploy/*.pem' --exclude='deploy/.deploy-env' -C "${PROJECT_DIR}" .`
  );

  console.log('==> Uploading to EC2...');
  run(
    `scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "${keyFile}" "${tarball}" ec2-user@${publicIp}:/tmp/sr-shoote-2r-deploy.tar.gz`
  );

  console.log('==> Installing on EC2...');
  const installScript = readFileSync(join(__dirname, 'install-on-ec2.sh'), 'utf8');
  const install = spawnSync(
    'ssh',
    [
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-i',
      keyFile,
      `ec2-user@${publicIp}`,
      `PUBLIC_URL=http://${publicIp} PORT=${APP_PORT} bash -s`,
    ],
    { input: installScript, encoding: 'utf8' }
  );
  process.stdout.write(install.stdout || '');
  process.stderr.write(install.stderr || '');
  if (install.status !== 0) throw new Error(`Install failed with code ${install.status}`);
}

async function main() {
  console.log('==> Checking AWS credentials...');
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  console.log(JSON.stringify({ Account: identity.Account, Arn: identity.Arn }, null, 2));

  const existing = loadEnvFile();
  if (REDEPLOY && existing.INSTANCE_ID && existing.PUBLIC_IP && existing.KEY_FILE) {
    console.log(`==> Redeploying to existing instance ${existing.INSTANCE_ID} (${existing.PUBLIC_IP})...`);
    const keyFile = existing.KEY_FILE;
    if (!existsSync(keyFile)) throw new Error(`Missing key file: ${keyFile}`);
    await waitSsh(keyFile, existing.PUBLIC_IP);
    await packageAndInstall(keyFile, existing.PUBLIC_IP);
    console.log('');
    console.log('============================================');
    console.log('  SR Shooter 2 redeployed!');
    console.log(`  Players:   http://${existing.PUBLIC_IP}/`);
    console.log(`  Organiser: http://${existing.PUBLIC_IP}/admin.html`);
    console.log(`  Instance:  ${existing.INSTANCE_ID}`);
    console.log('============================================');
    return;
  }

  console.log(`==> Resolving Amazon Linux 2023 AMI in ${AWS_REGION}...`);
  const images = await ec2.send(
    new DescribeImagesCommand({
      Owners: ['amazon'],
      Filters: [
        { Name: 'name', Values: ['al2023-ami-2023*-kernel-6.1-x86_64'] },
        { Name: 'state', Values: ['available'] },
      ],
    })
  );
  const sorted = (images.Images || []).sort((a, b) =>
    (a.CreationDate || '').localeCompare(b.CreationDate || '')
  );
  const AMI_ID = sorted.at(-1)?.ImageId;
  if (!AMI_ID) throw new Error('No AMI found');
  console.log(`AMI: ${AMI_ID}`);

  const keyFile = process.env.KEY_FILE || join(__dirname, `${KEY_NAME}.pem`);
  try {
    await ec2.send(new DescribeKeyPairsCommand({ KeyNames: [KEY_NAME] }));
    console.log(`Key pair ${KEY_NAME} already exists`);
    if (!existsSync(keyFile)) {
      throw new Error(
        `Key pair exists in AWS but ${keyFile} is missing locally. Set KEY_FILE=... or delete the AWS key pair.`
      );
    }
  } catch (err) {
    const notFound =
      err.Code === 'InvalidKeyPair.NotFound' ||
      err.name === 'InvalidKeyPair.NotFound' ||
      String(err.message || '').includes('does not exist');
    if (!notFound && !String(err.message || '').includes('missing locally')) throw err;
    if (!existsSync(keyFile)) {
      console.log(`==> Creating key pair ${KEY_NAME}...`);
      const key = await ec2.send(new CreateKeyPairCommand({ KeyName: KEY_NAME }));
      writeFileSync(keyFile, key.KeyMaterial, { mode: 0o600 });
      console.log(`Saved private key to deploy/${KEY_NAME}.pem`);
    }
  }

  const vpcs = await ec2.send(
    new DescribeVpcsCommand({ Filters: [{ Name: 'isDefault', Values: ['true'] }] })
  );
  const VPC_ID = vpcs.Vpcs?.[0]?.VpcId;
  if (!VPC_ID) throw new Error('No default VPC found');

  const sgs = await ec2.send(
    new DescribeSecurityGroupsCommand({
      Filters: [
        { Name: 'group-name', Values: [SG_NAME] },
        { Name: 'vpc-id', Values: [VPC_ID] },
      ],
    })
  );
  let SG_ID = sgs.SecurityGroups?.[0]?.GroupId;
  if (!SG_ID) {
    console.log(`==> Creating security group ${SG_NAME}...`);
    const sg = await ec2.send(
      new CreateSecurityGroupCommand({
        GroupName: SG_NAME,
        Description: 'SR Shooter 2 game server',
        VpcId: VPC_ID,
      })
    );
    SG_ID = sg.GroupId;
    await ec2.send(
      new AuthorizeSecurityGroupIngressCommand({
        GroupId: SG_ID,
        IpPermissions: [
          { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
          { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
          { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }] },
        ],
      })
    );
  }
  console.log(`Security group: ${SG_ID}`);

  console.log(`==> Launching EC2 instance (${INSTANCE_TYPE})...`);
  const runResult = await ec2.send(
    new RunInstancesCommand({
      ImageId: AMI_ID,
      InstanceType: INSTANCE_TYPE,
      KeyName: KEY_NAME,
      SecurityGroupIds: [SG_ID],
      TagSpecifications: [
        {
          ResourceType: 'instance',
          Tags: [{ Key: 'Name', Value: INSTANCE_NAME }],
        },
      ],
      MinCount: 1,
      MaxCount: 1,
    })
  );
  const INSTANCE_ID = runResult.Instances?.[0]?.InstanceId;
  console.log(`Instance ID: ${INSTANCE_ID}`);

  for (let i = 0; i < 60; i++) {
    const state = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
    const status = state.Reservations?.[0]?.Instances?.[0]?.State?.Name;
    if (status === 'running') break;
    if (i === 59) throw new Error(`Instance did not reach running state: ${status}`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  // Public IP can lag a few seconds after "running"
  let PUBLIC_IP = '';
  for (let i = 0; i < 12; i++) {
    const desc = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
    PUBLIC_IP = desc.Reservations?.[0]?.Instances?.[0]?.PublicIpAddress || '';
    if (PUBLIC_IP) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!PUBLIC_IP) throw new Error('No public IP assigned — check subnet/auto-assign public IPv4');
  console.log(`Public IP: ${PUBLIC_IP}`);

  writeFileSync(
    DEPLOY_ENV,
    [
      `AWS_REGION=${AWS_REGION}`,
      `INSTANCE_ID=${INSTANCE_ID}`,
      `PUBLIC_IP=${PUBLIC_IP}`,
      `KEY_FILE=${keyFile}`,
      `PUBLIC_URL=http://${PUBLIC_IP}`,
      `PORT=${APP_PORT}`,
      '',
    ].join('\n')
  );

  await waitSsh(keyFile, PUBLIC_IP);
  await packageAndInstall(keyFile, PUBLIC_IP);

  console.log('');
  console.log('============================================');
  console.log('  SR Shooter 2 deployed to AWS EC2!');
  console.log(`  Players:   http://${PUBLIC_IP}/`);
  console.log(`  Organiser: http://${PUBLIC_IP}/admin.html`);
  console.log(`  Health:    http://${PUBLIC_IP}/health`);
  console.log(`  Instance:  ${INSTANCE_ID}`);
  console.log(`  Region:    ${AWS_REGION}`);
  console.log('  Redeploy:  REDEPLOY=1 ./deploy/deploy.sh');
  console.log('============================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
