// shootLaser.mjs
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

// helper to broadcast to all connections
async function broadcastToAll(apigw, Items, payload) {
  await Promise.all(Items.map(async item => {
    try {
      await apigw.send(new PostToConnectionCommand({
        ConnectionId: item.connectionId,
        Data: payload
      }));
    } catch (err) {
      // clean up stale
      if (err.name === "GoneException" || err.$metadata?.httpStatusCode === 410) {
        await doc.send(new UpdateCommand({
          TableName: "LaserGamePlayers",
          Key: { name: item.name },
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

  // 1) Parse shooter + 3D ray info
  const { name, origin, direction } = JSON.parse(event.body);
  if (!name || !origin || !direction) {
    // malformed request
    await apigw.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify({
        action: "shootResult",
        error: "Invalid shoot payload"
      })
    }));
    return { statusCode: 400 };
  }

  // 2) Verify shooter exists
  const shooter = await doc.send(new GetCommand({
    TableName: "LaserGamePlayers",
    Key: { name }
  }));
  if (!shooter.Item) {
    await apigw.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify({
        action: "shootResult",
        error: "Player not found"
      })
    }));
    return { statusCode: 200 };
  }

  // 3) Scan all players to find nearest intersection
  const scan = await doc.send(new ScanCommand({
    TableName: "LaserGamePlayers"
  }));

  let closest = { player: null, t: Infinity };
  const radius = 0.5;  // approximate player size

  for (const p of scan.Items || []) {
    if (p.name === name) continue;

    // player center in world‐grid space: x→X, y→Z, assume Y at 0.5
    const cx = p.x, cy = 0.5, cz = p.y;
    // vector from ray origin to center
    const ocx = cx - origin.x;
    const ocy = cy - origin.y;
    const ocz = cz - origin.z;
    // project oc onto dir
    const tca = ocx*direction.x + ocy*direction.y + ocz*direction.z;
    if (tca < 0) continue;  // behind shooter

    // squared distance from center to ray
    const d2 = ocx*ocx + ocy*ocy + ocz*ocz - tca*tca;
    if (d2 > radius*radius) continue;  // miss

    const thc = Math.sqrt(radius*radius - d2);
    const t0  = tca - thc;
    if (t0 >= 0 && t0 < closest.t) {
      closest = { player: p, t: t0 };
    }
  }

  // 4) If hit, increment score
  let hitName = null;
  if (closest.player) {
    hitName = closest.player.name;
    await doc.send(new UpdateCommand({
      TableName: "LaserGamePlayers",
      Key: { name },
      UpdateExpression: "SET score = score + :inc",
      ExpressionAttributeValues: { ":inc": 1 }
    }));
  }

  // 5) Broadcast result to everyone
  //    (reuse your GSI scan for connections)
  const { Items = [] } = await doc.send(new ScanCommand({
    TableName: "LaserGamePlayers",
    IndexName: "connectionId",
    ProjectionExpression: "connectionId, #nm",
    ExpressionAttributeNames: { "#nm": "name" }
  }));

  const resultPayload = JSON.stringify({
    action: "shootResult",
    shooter: name,
    hit:    hitName ? { name: hitName } : null,
    message: hitName
      ? `Hit ${hitName}!`
      : "Miss!"
  });

  await broadcastToAll(apigw, Items, resultPayload);

  return { statusCode: 200 };
}
