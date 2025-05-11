// getGameState.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} from "@aws-sdk/client-apigatewaymanagementapi";

const client = new DynamoDBClient({});
const doc    = DynamoDBDocumentClient.from(client);

export async function handler(event) {
  const { domainName, stage, connectionId } = event.requestContext;
  const apigw = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`
  });

  const { Items = [] } = await doc.send(new ScanCommand({
    TableName: "LaserGamePlayers"
  }));

  await apigw.send(new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: JSON.stringify({ action: "gameState", players: Items })
  }));

  return { statusCode: 200 };
}
