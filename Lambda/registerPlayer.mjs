// registerPlayer.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} from "@aws-sdk/client-apigatewaymanagementapi";

const TABLE     = "LaserGamePlayers";
const ddb        = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddb);

export async function handler(event) {
  const { domainName, stage, connectionId } = event.requestContext;
  const name = event.queryStringParameters?.name;
  if (!name) {
    return { statusCode: 400, body: "Missing name" };
  }

  // 1) Write the new player (or overwrite an existing name) with their connectionId
  const now = Date.now();
  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: { connectionId, name, x: 0, y: 0, score: 0, online: true, lastActive: now }
  }));

  // 2) Build the WebSocket management client
  const apigw = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`
  });

  // 3) Grab all other live connections
  const { Items = [] } = await docClient.send(new ScanCommand({
    TableName: TABLE,
    ProjectionExpression: "connectionId, #nm",
    ExpressionAttributeNames: { "#nm": "name" },
    FilterExpression: "attribute_exists(connectionId)"
  }));

  // 4) Broadcast a playerJoined event to everyone _except_ the newcomer
  const joinPayload = JSON.stringify({
    action: "playerJoined",
    player: { name, x: 0, y: 0, score: 0 }
  });

  await Promise.all(
    Items
      .filter(item => item.connectionId !== connectionId)
      .map(async item => {
        try {
          await apigw.send(new PostToConnectionCommand({
            ConnectionId: item.connectionId,
            Data: joinPayload
          }));
        } catch (err) {
          // If they’ve gone away, clean them up
          if (err.name === "GoneException" || err.$metadata?.httpStatusCode === 410) {
            await docClient.send(new UpdateCommand({
              TableName: TABLE,
              Key: { name: item.name },
              UpdateExpression: "REMOVE connectionId"
            }));
          }
        }
      })
  );

  // 5) Done
  return { statusCode: 200, body: "Connected" };
}
