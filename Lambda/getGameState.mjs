// getGameState.mjs – now returns ONLY players currently online
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} from "@aws-sdk/client-apigatewaymanagementapi";

const client = new DynamoDBClient({});
const doc    = DynamoDBDocumentClient.from(client);
const TABLE  = "LaserGamePlayers";

export async function handler(event) {
  const { domainName, stage, connectionId } = event.requestContext;
  const apigw = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`
  });

  /* Return only those with online === true */
  const { Items = [] } = await doc.send(
    new ScanCommand({
      TableName: TABLE,
      ProjectionExpression: "#nm, x, y, baseY, score",
      ExpressionAttributeNames: { "#nm": "name", "#on": "online" },
      FilterExpression: "#on = :t",
      ExpressionAttributeValues:{ ":t": true }
    })
  );

  await apigw.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify({ action: "gameState", players: Items })
    })
  );

  return { statusCode: 200 };
}
