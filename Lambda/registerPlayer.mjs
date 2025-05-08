import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export async function handler(event) {
  const connectionId = event.requestContext.connectionId;
  const name = event.queryStringParameters?.name;
  if (!name) {
    return { statusCode: 400, body: "Missing name in query string" };
  }

  const now = Date.now();
  await docClient.send(new PutCommand({
    TableName: "LaserGamePlayers",
    Item: { connectionId, name, x: 0, y: 0, score: 0, online: true, lastActive: now }
  }));

  return { statusCode: 200, body: "Connected" };
}
