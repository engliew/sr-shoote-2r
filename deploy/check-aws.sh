#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
[[ -d node_modules ]] || npm install --omit=dev
AWS_REGION="${AWS_REGION:-ap-southeast-1}" node -e "
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
const region = process.env.AWS_REGION || 'ap-southeast-1';
try {
  const id = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
  console.log('AWS credentials OK');
  console.log('Account:', id.Account);
  console.log('ARN:', id.Arn);
  console.log('Region:', region);
} catch (e) {
  console.error('AWS credentials INVALID — update ~/.aws/credentials or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY');
  console.error(e.message);
  process.exit(1);
}
"
