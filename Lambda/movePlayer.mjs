// movePlayer.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
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

const ddb       = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddb);

const TABLE     = "LaserGamePlayers";
const GRID_SIZE = 135;               // keep in sync with Game.js grid

export async function handler(event) {
  console.log("movePlayer invoked:", event.body);

  const { domainName, stage } = event.requestContext;
  const apigw = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`
  });

  /* ------------------------------------------------- *
   * 1) Parse payload  { name, x, y }
   * ------------------------------------------------- */
  const { name: playerName, x: rawX, y: rawY } = JSON.parse(event.body || "{}");
  if (playerName === undefined || rawX === undefined || rawY === undefined) {
    return { statusCode: 400, body: "Missing name / x / y" };
  }

  // Clamp to grid and round to int
  const x = Math.max(0, Math.min(GRID_SIZE - 1, Math.round(rawX)));
  const y = Math.max(0, Math.min(GRID_SIZE - 1, Math.round(rawY)));

  /* ------------------------------------------------- *
   * 2) Ensure player exists
   * ------------------------------------------------- */
  const { Item } = await docClient.send(new GetCommand({
    TableName: TABLE,
    Key: { name: playerName }
  }));
  if (!Item) return { statusCode: 404, body: "Player not found" };

  /* ------------------------------------------------- *
   * 3) Update position in DynamoDB
   * ------------------------------------------------- */
  await docClient.send(new UpdateCommand({
    TableName: TABLE,
    Key: { name: playerName },
    UpdateExpression:
      "SET #x = :x, #y = :y, #online = :on, #lastActive = :now",
    ExpressionAttributeNames: {
      "#x": "x",
      "#y": "y",
      "#online": "online",
      "#lastActive": "lastActive"      // ★ added
    },
    ExpressionAttributeValues: {
      ":x": x,
      ":y": y,
      ":on": true,
      ":now": Date.now()
    }
  }));

  /* ------------------------------------------------- *
   * 4) Broadcast to everyone online
   * ------------------------------------------------- */
  const { Items = [] } = await docClient.send(new ScanCommand({
    TableName: TABLE,
    ProjectionExpression: "connectionId, #nm",
    FilterExpression: "#online = :true",
    ExpressionAttributeNames: { "#nm": "name", "#online": "online" },
    ExpressionAttributeValues: { ":true": true }
  }));

  const payload = JSON.stringify({
    action: "playerMoved",
    name:   playerName,
    x,
    y
  });

  await Promise.all(
    Items.filter(c => c.connectionId).map(c =>
      apigw.send(new PostToConnectionCommand({
        ConnectionId: c.connectionId,
        Data: payload
      })).catch(err => {
        // Clean up stale connections
        if (err.name === "GoneException" ||
            err.$metadata?.httpStatusCode === 410) {
          return docClient.send(new UpdateCommand({
            TableName: TABLE,
            Key: { name: c.name },
            UpdateExpression: "REMOVE connectionId SET #online = :false",
            ExpressionAttributeNames: { "#online": "online" },
            ExpressionAttributeValues: { ":false": false }
          }));
        }
      })
    )
  );

  return { statusCode: 200, body: "OK" };
}
