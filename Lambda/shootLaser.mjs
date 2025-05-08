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

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);

export async function handler(event) {
  // Build WebSocket management client
  const { domainName, stage, connectionId } = event.requestContext;
  const apigw = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`
  });

  // Parse incoming JSON (must include name & direction)
  const { name, direction } = JSON.parse(event.body);

  // Load the shooter’s record by name
  const getResult = await doc.send(new GetCommand({
    TableName: "LaserGamePlayers",
    Key: { name }
  }));

  if (!getResult.Item) {
    // Notify client of error
    const errPayload = JSON.stringify({
      action: "shootResult",
      error: "Player not found"
    });
    await apigw.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: errPayload
    }));
    return { statusCode: 200, body: "Handled missing player" };
  }

  const { x, y } = getResult.Item;

  // Scan for other players and detect a hit
  const scanResult = await doc.send(new ScanCommand({
    TableName: "LaserGamePlayers"
  }));

  let hit = null;
  for (const player of scanResult.Items || []) {
    if (player.name === name) continue;
    const dx = player.x - x;
    const dy = player.y - y;

    if (
      (direction === "up"    && dx === 0 && dy < 0) ||
      (direction === "down"  && dx === 0 && dy > 0) ||
      (direction === "left"  && dy === 0 && dx < 0) ||
      (direction === "right" && dy === 0 && dx > 0)
    ) {
      hit = player;
      break;
    }
  }

  // If hit, increment shooter’s score
  if (hit) {
    await doc.send(new UpdateCommand({
      TableName: "LaserGamePlayers",
      Key: { name },
      UpdateExpression: "SET score = score + :inc",
      ExpressionAttributeValues: { ":inc": 1 }
    }));
  }

  // Build and send the response back over WebSocket
  const payload = JSON.stringify({
    action: "shootResult",
    result: hit ? `Hit ${hit.name}` : "Miss",
    score: hit ? "Point awarded!" : "Better luck next time!"
  });

  await apigw.send(new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: payload
  }));

  return { statusCode: 200, body: "OK" };
}
