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
  // **1. Log the entire incoming event**
  console.log("Logout event received:", JSON.stringify(event, null, 2));

  // **2. Defensive check for requestContext and connectionId**
  if (!event || !event.requestContext || !event.requestContext.connectionId) {
    console.error("Error: requestContext or connectionId missing in logout event.", event);
    // Depending on how API Gateway handles errors from $disconnect,
    // returning an error might be appropriate, or just logging and exiting.
    // For $disconnect, usually, you can't send a response back to the closed connection.
    return { statusCode: 200 }; // Or 500 if you want to flag an issue in metrics
  }

  const connectionId = event.requestContext.connectionId;
  const tableName    = "LaserGamePlayers";
  console.log(`Processing $disconnect for connectionId: ${connectionId}`);

  // 3) Find the player record by connectionId GSI
  let playerToLogout;
  try {
    const { Items = [] } = await docClient.send(new QueryCommand({
      TableName: tableName,
      IndexName: "connectionId", // your GSI name (lowercase)
      KeyConditionExpression: "connectionId = :cid",
      ExpressionAttributeValues: { ":cid": connectionId }
    }));

    if (Items.length === 0) {
      console.log(`No player found with connectionId: ${connectionId}. Nothing to do for logout.`);
      return { statusCode: 200 };
    }
    playerToLogout = Items[0];
    console.log("Player found for logout:", JSON.stringify(playerToLogout, null, 2));
  } catch (err) {
    console.error(`Error querying for player with connectionId ${connectionId}:`, JSON.stringify(err, null, 2));
    return { statusCode: 500 }; // Internal error
  }

  const { name } = playerToLogout;
  if (!name) {
    console.error(`Player item found for connectionId ${connectionId} is missing a 'name'. Cannot update. Item:`, JSON.stringify(playerToLogout, null, 2));
    return { statusCode: 500 }; // Data integrity issue
  }

  // 4) Mark offline and remove the stale connectionId
  try {
    console.log(`Updating player '${name}' to offline and removing connectionId.`);
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { name }, // primary key
      UpdateExpression: "SET #online = :f REMOVE connectionId",
      ExpressionAttributeNames: { "#online": "online" },
      ExpressionAttributeValues: { ":f": false }
    }));
    console.log(`Player '${name}' successfully marked as offline.`);
  } catch (err) {
    console.error(`Error updating player '${name}' for logout:`, JSON.stringify(err, null, 2));
    return { statusCode: 500 }; // Internal error
  }

  return { statusCode: 200 };
}