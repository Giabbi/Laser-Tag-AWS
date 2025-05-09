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

/**
 * Broadcasts payload to all given connections,
 * cleaning up any goneException stale entries.
 *
 * @param {import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient} docClient
 * @param {import("@aws-sdk/client-apigatewaymanagementapi").ApiGatewayManagementApiClient} apigw
 * @param {{ connectionId: string, name: string }[]} connections
 * @param {string} payload
 */
async function broadcastToAll(docClient, apigw, connections, payload) {
  console.log(`📣 broadcasting to ${connections.length} connections:`,
    connections.map(c => c.connectionId));
  await Promise.all(connections.map(async connItem => {
    const conn = connItem.connectionId;
    try {
      await apigw.send(new PostToConnectionCommand({
        ConnectionId: conn,
        Data: payload
      }));
      console.log("    ✅ sent to", conn);
    } catch (err) {
      console.warn("    ❌ error sending to", conn, err.name);
      if (err.name === "GoneException" || err.$metadata?.httpStatusCode === 410) {
        console.log(`Cleaning up stale connection ${conn} for player ${connItem.name}`);
        await docClient.send(new UpdateCommand({
          TableName: "LaserGamePlayers",
          Key: { name: connItem.name },
          UpdateExpression: "REMOVE connectionId"
        }));
      }
    }
  }));
}

export async function handler(event) {
  const { domainName, stage, connectionId } = event.requestContext;
  const apigw = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`
  });

  // 1) Parse incoming
  const { name, direction } = JSON.parse(event.body);

  // 2) Load & update that player
  const { Item = {} } = await docClient.send(new GetCommand({
    TableName: "LaserGamePlayers",
    Key: { name }
  }));

  let { x = 0, y = 0, score = 0 } = Item;
  const gridSize = 15;
  switch (direction) {
    case "up":    y = Math.max(0, y - 1); break;
    case "down":  y = Math.min(gridSize - 1, y + 1); break;
    case "left":  x = Math.max(0, x - 1); break;
    case "right": x = Math.min(gridSize - 1, x + 1); break;
  }

  await docClient.send(new UpdateCommand({
    TableName: "LaserGamePlayers",
    Key: { name },
    UpdateExpression: [
      "SET #x = :x",
      "  , #y = :y",
      "  , #score = :score",
      "  , #online = :online",
      "  , #lastActive = :now"
    ].join(" "),
    ExpressionAttributeNames: {
      "#x": "x",
      "#y": "y",
      "#score": "score",
      "#online": "online",
      "#lastActive": "lastActive"
    },
    ExpressionAttributeValues: {
      ":x": x,
      ":y": y,
      ":score": score,
      ":online": true,
      ":now": Date.now()
    }
  }));

  // 3) Scan entire table for everyone with a connectionId
  const { Items = [] } = await docClient.send(new ScanCommand({
    TableName: "LaserGamePlayers",
    ProjectionExpression: "connectionId, #nm",
    ExpressionAttributeNames: { "#nm": "name" }
  }));

  // 4) Broadcast it
  const payload = JSON.stringify({ action: "playerMoved", name, x, y });
  await broadcastToAll(docClient, apigw, Items, payload);

  return { statusCode: 200, body: "OK" };
}
