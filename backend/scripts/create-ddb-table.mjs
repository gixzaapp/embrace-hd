// Creates the single DynamoDB table used by the backend (pk/sk + gsi1 + TTL).
// Usage:
//   DDB_TABLE=embrace-hd AWS_REGION=eu-west-2 node scripts/create-ddb-table.mjs
// Credentials are read from the standard AWS provider chain (env vars,
// shared config/credentials file, or an attached IAM role).

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';

const TableName = process.env.DDB_TABLE?.trim() || 'embrace-hd';
const region =
  process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'eu-west-2';
const endpoint = process.env.DDB_ENDPOINT?.trim() || undefined;

const client = new DynamoDBClient({ region, ...(endpoint ? { endpoint } : {}) });

async function tableExists() {
  try {
    await client.send(new DescribeTableCommand({ TableName }));
    return true;
  } catch (err) {
    if (err?.name === 'ResourceNotFoundException') return false;
    throw err;
  }
}

async function main() {
  console.log(`Region: ${region}  Table: ${TableName}${endpoint ? `  Endpoint: ${endpoint}` : ''}`);

  if (await tableExists()) {
    console.log('Table already exists — nothing to create.');
    return;
  }

  await client.send(
    new CreateTableCommand({
      TableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
        { AttributeName: 'gsi1pk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'gsi1',
          KeySchema: [{ AttributeName: 'gsi1pk', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    })
  );
  console.log('CreateTable requested — waiting for ACTIVE...');

  await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName });

  await client.send(
    new UpdateTimeToLiveCommand({
      TableName,
      TimeToLiveSpecification: { Enabled: true, AttributeName: 'ttl' },
    })
  );

  console.log(`Done. Table "${TableName}" is ACTIVE with gsi1 + TTL(ttl) enabled.`);
}

main().catch((err) => {
  console.error('Failed to create table:', err);
  process.exit(1);
});
