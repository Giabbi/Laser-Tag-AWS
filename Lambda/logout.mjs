// logout.mjs  – broadcasts playerLeft and no longer throws ValidationException
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  ScanCommand
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand
} from "@aws-sdk/client-apigatewaymanagementapi";

const client    = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE     = "LaserGamePlayers";

export async function handler(event) {
  console.log("Logout event received:", JSON.stringify(event, null, 2));

  // 0) Guard — need connectionId on $disconnect
  if (!event?.requestContext?.connectionId) return { statusCode: 200 };
  const { connectionId, domainName, stage } = event.requestContext;

  // 1) Fetch the player bound to that connectionId
  const { Items: found = [] } = await docClient.send(
    new QueryCommand({
      TableName:  TABLE,
      IndexName:  "connectionId",
      KeyConditionExpression: "connectionId = :cid",
      ExpressionAttributeValues: { ":cid": connectionId }
    })
  );
  if (found.length === 0) return { statusCode: 200 };
  const { name } = found[0];

  // 2) Mark them offline & drop connectionId
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { name },
      UpdateExpression: "SET #online = :f REMOVE connectionId",
      ExpressionAttributeNames: { "#online": "online" },
      ExpressionAttributeValues:{ ":f": false }
    })
  );

  // 3) Notify everyone still online
  const apigw = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`
  });

  const { Items: others = [] } = await docClient.send(
    new ScanCommand({
      TableName: TABLE,
      ProjectionExpression: "connectionId, #nm",
      ExpressionAttributeNames: { "#nm": "name" },
      FilterExpression: "attribute_exists(connectionId)"
    })
  );

  const payload = JSON.stringify({ action: "playerLeft", name });

  await Promise.all(
    others.map(async (p) => {
      try {
        await apigw.send(
          new PostToConnectionCommand({
            ConnectionId: p.connectionId,
            Data: payload
          })
        );
      } catch (err) {
        // Clean up stale sockets
        if (err.name === "GoneException" || err.$metadata?.httpStatusCode === 410) {
          await docClient.send(
            new UpdateCommand({
              TableName: TABLE,
              Key: { name: p.name },
              UpdateExpression: "REMOVE connectionId SET #online = :f",
              ExpressionAttributeNames: { "#online": "online" },
              ExpressionAttributeValues:{ ":f": false }
            })
          );
        }
      }
    })
  );

  return { statusCode: 200 };
}
