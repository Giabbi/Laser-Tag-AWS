// movePlayer.mjs
import { DynamoDBClient }  from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} from "@aws-sdk/client-apigatewaymanagementapi";

const ddb = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddb);

export async function handler(event) {
  const handlerStartTime = Date.now();
  console.log("movePlayer invoked with event:", JSON.stringify(event, null, 2)); // Pretty print event

  const { domainName, stage, connectionId: moverConnectionId } = event.requestContext;
  const apigw = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`
  });

  const { name: playerName, direction } = JSON.parse(event.body);
  let timeAfterParse = Date.now();
  console.log(`Time after parse: ${timeAfterParse - handlerStartTime}ms`);

  let playerItem;
  try {
    const getResult = await docClient.send(new GetCommand({
      TableName: "LaserGamePlayers",
      Key: { name: playerName }
    }));
    playerItem = getResult.Item;
  } catch (err) {
    console.error("Error getting player:", playerName, JSON.stringify(err, null, 2));
    return { statusCode: 500, body: "Failed to get player" };
  }
  let timeAfterGet = Date.now();
  console.log(`Time after GetCommand for ${playerName}: ${timeAfterGet - timeAfterParse}ms. Player found: ${!!playerItem}`);

  if (!playerItem) {
    console.warn("Player not found during move:", playerName);
    return { statusCode: 404, body: "Player not found" };
  }

  let { x = 0, y = 0, score = 0 } = playerItem;
  const gridSize = 135;
  switch (direction) {
    case "up":    y = Math.max(0, y - 1); break;
    case "down":  y = Math.min(gridSize - 1, y + 1); break;
    case "left":  x = Math.max(0, x - 1); break;
    case "right": x = Math.min(gridSize - 1, x + 1); break;
  }
  let timeAfterCalc = Date.now();
  console.log(`Time after calculation: ${timeAfterCalc - timeAfterGet}ms`);

  try {
    await docClient.send(new UpdateCommand({
      TableName: "LaserGamePlayers",
      Key: { name: playerName },
      UpdateExpression: "SET #x = :x, #y = :y, #score = :score, #online = :online, #lastActive = :now",
      ExpressionAttributeNames: {
        "#x": "x", "#y": "y", "#score": "score", "#online": "online", "#lastActive": "lastActive"
      },
      ExpressionAttributeValues: {
        ":x": x, ":y": y, ":score": score, ":online": true, ":now": Date.now()
      }
    }));
  } catch (err) {
    console.error("Error updating player:", playerName, JSON.stringify(err, null, 2));
    return { statusCode: 500, body: "Failed to update player" };
  }
  let timeAfterUpdate = Date.now();
  console.log(`Time after UpdateCommand for ${playerName}: ${timeAfterUpdate - timeAfterCalc}ms`);

  let connectionsToBroadcast = [];
  try {
    const scanResult = await docClient.send(new ScanCommand({
      TableName: "LaserGamePlayers",
      ProjectionExpression: "connectionId, #nm",
      FilterExpression: "#online = :true",
      ExpressionAttributeNames: { "#nm": "name", "#online": "online" },
      ExpressionAttributeValues: { ":true": true }
    }));
    connectionsToBroadcast = scanResult.Items || [];
  } catch (err) {
    console.error("Error scanning for connections:", JSON.stringify(err, null, 2));
  }
  let timeAfterScan = Date.now();
  console.log(`Time after ScanCommand for broadcast: ${timeAfterScan - timeAfterUpdate}ms. Found ${connectionsToBroadcast.length} online connections to consider.`);

  // *** ADD THIS DETAILED LOGGING BLOCK ***
  console.log("DEBUG: moverConnectionId:", moverConnectionId);
  console.log("DEBUG: connectionsToBroadcast (before filter):", JSON.stringify(connectionsToBroadcast, null, 2));
  // **************************************

  const payload = JSON.stringify({ action: "playerMoved", name: playerName, x, y });
  const connectionsToSendTo = connectionsToBroadcast
  .filter(conn => conn && conn.connectionId);

  // *** ADD THIS DETAILED LOGGING BLOCK ***
  console.log("DEBUG: connectionsToSendTo (after filter):", JSON.stringify(connectionsToSendTo, null, 2));
  // **************************************

  const broadcastPromises = connectionsToSendTo.map(connItem => {
      return apigw.send(new PostToConnectionCommand({
        ConnectionId: connItem.connectionId,
        Data: payload
      })).then(() => {
          console.log(`Successfully sent playerMoved to ${connItem.name} (${connItem.connectionId})`);
      }).catch(err => {
        console.warn(`Error sending to ${connItem.connectionId} (${connItem.name || 'N/A'}):`, err.name, JSON.stringify(err, null, 2));
        if (err.name === "GoneException" || err.$metadata?.httpStatusCode === 410) {
          console.log(`Cleaning up stale connection ${connItem.connectionId} for player ${connItem.name}`);
          docClient.send(new UpdateCommand({
            TableName: "LaserGamePlayers",
            Key: { name: connItem.name },
            UpdateExpression: "REMOVE connectionId SET #online = :false",
            ExpressionAttributeNames: { "#online": "online" },
            ExpressionAttributeValues: { ":false": false }
          })).catch(cleanupErr => console.error("Error during stale connection cleanup for", connItem.name, JSON.stringify(cleanupErr, null, 2)));
        }
      });
    });

  if (broadcastPromises.length > 0) {
    console.log(`Attempting to broadcast to ${broadcastPromises.length} connection(s).`);
    await Promise.all(broadcastPromises);
  } else {
      console.log("No other active connections to broadcast to (broadcastPromises array is empty).");
  }

  let timeAfterBroadcast = Date.now();
  console.log(`Time after broadcast processing: ${timeAfterBroadcast - timeAfterScan}ms`); // This scan time now includes the new debug logs
  console.log(`Total movePlayer execution time: ${Date.now() - handlerStartTime}ms`);
  return { statusCode: 200, body: "OK" };
}