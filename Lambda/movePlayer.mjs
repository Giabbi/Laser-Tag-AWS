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
const doc = DynamoDBDocumentClient.from(ddb);

async function broadcastToAll(doc, apigw, Items, payload) {
  await Promise.all(Items.map(async item => {
    const conn = item.connectionId;
    try {
      await apigw.send(new PostToConnectionCommand({
        ConnectionId: conn,
        Data: payload
      }));
    } catch (err) {
      // 410 = GoneException
      if (err.name === "GoneException" || err.$metadata?.httpStatusCode === 410) {
        console.log(`Cleaning up stale connection ${conn} for player ${item.name}`);
        // remove the stale connectionId from the player's record
        await doc.send(new UpdateCommand({
          TableName: "LaserGamePlayers",
          Key: { name: item.name },
          UpdateExpression: "REMOVE connectionId"
        }));
      } else {
        console.error("Failed to broadcast to", conn, err);
      }
    }
  }));
}


export async function handler(event) {
  // WebSocket management client
  const { domainName, stage, connectionId } = event.requestContext;
  const apigw = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`
  });

  // Pull name AND direction from the payload
  const { name, direction } = JSON.parse(event.body);

  // Load that player by name
  const { Item = {} } = await doc.send(new GetCommand({
    TableName: "LaserGamePlayers",
    Key: { name }
  }));

  // Destructure position & score
  let { x = 0, y = 0, score = 0 } = Item;

  // Apply movement logic
  const gridSize = 10;
  switch (direction) {
    case "up":    y = Math.max(0, y - 1); break;
    case "down":  y = Math.min(gridSize - 1, y + 1); break;
    case "left":  x = Math.max(0, x - 1); break;
    case "right": x = Math.min(gridSize - 1, x + 1); break;
  }

  // Write back exactly as before
  const now = Date.now();
  await doc.send(new UpdateCommand({
    TableName: "LaserGamePlayers",
    Key: { name },
    UpdateExpression: [
      "SET #x        = :x",
      "  , #y        = :y",
      "  , #score    = :score",
      "  , #online   = :online",
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
      ":now": now
    }
  }));
  
  

  const { Items = [] } = await doc.send(new ScanCommand({
    TableName: "LaserGamePlayers",
    IndexName: "connectionId",
    ProjectionExpression: "connectionId, #nm",
    ExpressionAttributeNames: { 
      "#nm": "name" 
    }
  }));
  

  const payload = JSON.stringify({
    action: "playerMoved",
    name, x, y
  });
    +  await broadcastToAll(doc, apigw, Items, payload);
  // Return stub
  return { statusCode: 200, body: "OK" };
}
