import { DynamoDBClient }  from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} from "@aws-sdk/client-apigatewaymanagementapi";

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);

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
  await doc.send(new PutCommand({
    TableName: "LaserGamePlayers",
    Item: { name, x, y, score, online: true, lastActive: now }
  }));

  // Notify the caller
  const payload = JSON.stringify({
    action: "playerMoved",
    x, y
  });
  await apigw.send(new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: payload
  }));

  // Return stub
  return { statusCode: 200, body: "OK" };
}
