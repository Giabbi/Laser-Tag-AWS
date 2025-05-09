// logout.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";

const client    = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export async function handler(event) {
  const connectionId = event.requestContext.connectionId;
  const tableName    = "LaserGamePlayers";

  // 1) Find the player record by connectionId GSI
  const { Items = [] } = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: "connectionId",              // your GSI name (lowercase)
    KeyConditionExpression: "connectionId = :cid",
    ExpressionAttributeValues: { ":cid": connectionId }
  }));

  if (Items.length === 0) {
    // no player found for this connection — nothing to do
    return { statusCode: 200 };
  }

  const { name } = Items[0];

  // 2) Mark offline and remove the stale connectionId
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { name },                         // primary key
    UpdateExpression: "SET #online = :f REMOVE connectionId",
    ExpressionAttributeNames: { "#online": "online" },
    ExpressionAttributeValues: { ":f": false }
  }));

  return { statusCode: 200 };
}
