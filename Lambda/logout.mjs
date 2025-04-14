// logout.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export async function handler(event) {
  // Handle OPTIONS requests if needed
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,GET,POST"
      },
      body: JSON.stringify({})
    };
  }

  const body = JSON.parse(event.body);
  const { name } = body;
  
  const params = {
    TableName: "LaserGamePlayers",
    Key: { name },
    UpdateExpression: "set online = :status",
    ExpressionAttributeValues: { ":status": false }
  };

  await docClient.send(new UpdateCommand(params));

  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "OPTIONS,GET,POST"
    },
    body: JSON.stringify({ message: "Logged out" })
  };
}
