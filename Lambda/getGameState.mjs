import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export async function handler() {
  try {
    const data = await docClient.send(new ScanCommand({ TableName: "LaserGamePlayers" }));
    const now = Date.now();
    // Only include players active in the last 60 seconds (60000 ms)
    const activePlayers = (data.Items || []).filter(player => 
      player.lastActive && (now - player.lastActive <= 60000)
    );
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*", 
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,GET,POST"
      },
      body: JSON.stringify(activePlayers)
    };
  } catch (error) {
    console.error("Error scanning table:", error);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ message: "Internal server error" })
    };
  }
}
