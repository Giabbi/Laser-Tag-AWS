import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export async function handler(event) {
  const connectionId = event.requestContext.connectionId;
  await docClient.send(new UpdateCommand({
    TableName: "LaserGamePlayers",
    Key: { name },
    UpdateExpression: "SET online = :false",
    ExpressionAttributeValues: { ":false": false }
  }));

  return { statusCode: 200, body: "" };
}
