import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const gridSize = 10; // 10x10 grid

export async function handler(event) {
  const body = JSON.parse(event.body);
  const { name, direction } = body;

  const getParams = {
    TableName: "LaserGamePlayers",
    Key: { name }
  };

  const data = await docClient.send(new GetCommand(getParams));
  let { x = 0, y = 0, score = 0 } = data.Item || {};

  switch (direction) {
    case 'up':    y = Math.max(0, y - 1); break;
    case 'down':  y = Math.min(gridSize - 1, y + 1); break;
    case 'left':  x = Math.max(0, x - 1); break;
    case 'right': x = Math.min(gridSize - 1, x + 1); break;
    default: break;
  }

const now = Date.now();
const updateParams = {
  TableName: "LaserGamePlayers",
  Item: { 
    name, 
    x, 
    y, 
    score,
    online: true,
    lastActive: now 
  }
};

await docClient.send(new PutCommand(updateParams));


  await docClient.send(new PutCommand(updateParams));

  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*", 
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "OPTIONS,GET,POST"
    },
    body: JSON.stringify({ message: "Moved", x, y })
  };
}
