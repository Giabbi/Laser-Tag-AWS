import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export async function handler(event) {
  const body = JSON.parse(event.body);
  const { name } = body;
  const now = Date.now(); 

  const params = {
    TableName: "LaserGamePlayers",
    Item: {
      name,
      x: 0,
      y: 0,
      score: 0,
      online: true,          
      lastActive: now        
    }
  };

  await docClient.send(new PutCommand(params));

  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*", 
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "OPTIONS,GET,POST"
    },
    body: JSON.stringify({ message: `Player ${name} registered.` })
  };
}
