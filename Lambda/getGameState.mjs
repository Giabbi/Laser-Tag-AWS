import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} from "@aws-sdk/client-apigatewaymanagementapi";

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);

export async function handler(event) {
  // Build the WebSocket management client for this invocation
  const { domainName, stage, connectionId } = event.requestContext;
  const endpoint = `https://${domainName}/${stage}`;
  const apigw = new ApiGatewayManagementApiClient({ endpoint });

  // Fetch & filter players exactly as before
  const data = await doc.send(new ScanCommand({ TableName: "LaserGamePlayers" }));
  const now = Date.now();
  const activePlayers = (data.Items || []).filter(p =>
    p.lastActive && now - p.lastActive <= 60_000
  );

  // Push the JSON back to the caller
  const payload = JSON.stringify({
    action: "gameState",      // client‐side can switch on this
    players: activePlayers
  });

  await apigw.send(new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: payload
  }));

  // Return a trivial 200 — the body is ignored for WebSocket routes
  return { statusCode: 200, body: "OK" };
}
