import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { env } from '../config/env.js';

/**
 * Single-table DynamoDB access layer.
 *
 * Key design (partition key `pk`, sort key `sk`):
 *   USER#<id>        / USER      (gsi1pk = PHONE#<e164> for phone lookups)
 *   OTP#<e164>       / OTP       (ttl set — auto-expires)
 *   SESSION#<token>  / SESSION   (ttl set — auto-expires)
 *   TRIAL#<deviceId> / TRIAL
 *   CONFIG           / CONFIG
 *
 * GSI `gsi1` (partition key `gsi1pk`) powers "find user by phone".
 * TTL attribute is `ttl` (epoch seconds).
 */

export const GSI1_NAME = 'gsi1';

let docClient: DynamoDBDocumentClient | null = null;

export function ddb(): DynamoDBDocumentClient {
  if (!docClient) {
    const base = new DynamoDBClient({
      region: env.awsRegion,
      ...(env.ddbEndpoint ? { endpoint: env.ddbEndpoint } : {}),
    });
    docClient = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}

export function tableName(): string {
  return env.ddbTable;
}

export function epochSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

export async function ddbGet<T>(pk: string, sk: string): Promise<T | null> {
  const out = await ddb().send(
    new GetCommand({ TableName: tableName(), Key: { pk, sk } })
  );
  return (out.Item as T | undefined) ?? null;
}

export async function ddbPut(item: Record<string, unknown>): Promise<void> {
  await ddb().send(new PutCommand({ TableName: tableName(), Item: item }));
}

export async function ddbDelete(pk: string, sk: string): Promise<void> {
  await ddb().send(
    new DeleteCommand({ TableName: tableName(), Key: { pk, sk } })
  );
}

export async function ddbQueryByGsi1<T>(gsi1pk: string): Promise<T[]> {
  const out = await ddb().send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'gsi1pk = :p',
      ExpressionAttributeValues: { ':p': gsi1pk },
      Limit: 1,
    })
  );
  return (out.Items as T[] | undefined) ?? [];
}
