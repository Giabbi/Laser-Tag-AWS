import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export async function handler(event) {
  const body = JSON.parse(event.body);
  const { name, direction } = body;

  // Get the source player's data
  const getResult = await docClient.send(new GetCommand({
    TableName: "LaserGamePlayers",
    Key: { name }
  }));

  if (!getResult.Item) {
    return {
      statusCode: 404,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ message: "Player not found" })
    };
  }

  const { x, y } = getResult.Item;

  // Scan to find other players
  const scanResult = await docClient.send(new ScanCommand({ TableName: "LaserGamePlayers" }));

  let hit = null;
  for (const player of scanResult.Items) {
    if (player.name === name) continue;

    const dx = player.x - x;
    const dy = player.y - y;

    if (
      (direction === "up" && dx === 0 && dy < 0) ||
      (direction === "down" && dx === 0 && dy > 0) ||
      (direction === "left" && dy === 0 && dx < 0) ||
      (direction === "right" && dy === 0 && dx > 0)
    ) {
      hit = player;
      break;
    }
  }

  if (hit) {
    // Update the shooter's score
    await docClient.send(new UpdateCommand({
      TableName: "LaserGamePlayers",
      Key: { name },
      UpdateExpression: "SET score = score + :inc",
      ExpressionAttributeValues: { ":inc": 1 }
    }));
  }

  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*", 
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "OPTIONS,GET,POST"
    },
    body: JSON.stringify({
      result: hit ? `Hit ${hit.name}` : "Miss",
      score: hit ? "Point awarded!" : "No change"
    })
  };
}
