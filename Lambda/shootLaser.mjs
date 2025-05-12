// shootLaser.mjs – fixed world‑space hit‑detection + broadcast origin/dir
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

/* -------------------------------------------------- *
 * Constants – keep in sync with Game.js
 * -------------------------------------------------- */
const GRID_SIZE  = 135;   // <- same as Game.gridSize
const SPACING    = 0.2;   // <- same as Game.spacing (world‑units / grid‑cell)
const PLAYER_RAD = 0.5;   // player half‑width in world units (cubeSize = 1)

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);

// helper to broadcast to all live connections
async function broadcastToAll(apigw, items, payload) {
  await Promise.all(
    items.map(async (item) => {
      if (!item.connectionId) return;
      try {
        await apigw.send(
          new PostToConnectionCommand({
            ConnectionId: item.connectionId,
            Data: payload,
          })
        );
      } catch (err) {
        if (err.name === "GoneException" || err.$metadata?.httpStatusCode === 410) {
          // tidy stale connection
          await doc.send(
            new UpdateCommand({
              TableName: "LaserGamePlayers",
              Key: { name: item.name },
              UpdateExpression: "REMOVE connectionId SET #on = :f",
              ExpressionAttributeNames: { "#on": "online" },
              ExpressionAttributeValues: { ":f": false },
            })
          );
        }
      }
    })
  );
}

export async function handler(event) {
  const { domainName, stage, connectionId } = event.requestContext;
  const apigw = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });

  /* 1) Parse payload */
  let parsed;
  try {
    parsed = JSON.parse(event.body || "{}");
  } catch (_) {
    parsed = {};
  }
  const { name, origin, direction } = parsed;
  if (!name || !origin || !direction) {
    await apigw.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "shootResult", error: "Invalid shoot payload" }),
      })
    );
    return { statusCode: 400 };
  }

  /* 2) Shooter exists? */
  const shooter = await doc.send(new GetCommand({ TableName: "LaserGamePlayers", Key: { name } }));
  if (!shooter.Item) {
    await apigw.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({ action: "shootResult", error: "Player not found" }),
      })
    );
    return { statusCode: 200 };
  }

  /* 3) Convert all player positions to *world* coords and test ray‑sphere */
  const scan = await doc.send(new ScanCommand({ TableName: "LaserGamePlayers" }));

  const dir    = direction; // assumed already normalised by client
  let closestT = Infinity;
  let hitPlayer = null;

  for (const p of scan.Items || []) {
    if (p.name === name) continue; // don't hit yourself

    // grid -> world transform
    const cx = (p.x - GRID_SIZE / 2 + 0.5) * SPACING;
    const baseY = typeof p.baseY === "number" ? p.baseY : 0;
    const cy = baseY + PLAYER_RAD;                // <<–– now takes ramp height into account
    const cz = (p.y - GRID_SIZE / 2 + 0.5) * SPACING;

    // vector from origin to centre
    const ocx = cx - origin.x;
    const ocy = cy - origin.y;
    const ocz = cz - origin.z;

    // projection length of oc onto dir
    const tca = ocx * dir.x + ocy * dir.y + ocz * dir.z;
    if (tca < 0) continue; // behind shooter

    // squared distance from sphere centre to ray
    const d2 = ocx * ocx + ocy * ocy + ocz * ocz - tca * tca;
    if (d2 > PLAYER_RAD * PLAYER_RAD) continue; // miss

    // distance from tca to intersection
    const thc   = Math.sqrt(PLAYER_RAD * PLAYER_RAD - d2);
    const tHit  = tca - thc;
    if (tHit >= 0 && tHit < closestT) {
      closestT  = tHit;
      hitPlayer = p;
    }
  }

  /* 4) Award point */
  let hitName = null;
  if (hitPlayer) {
    hitName = hitPlayer.name;
    await doc.send(
      new UpdateCommand({
        TableName: "LaserGamePlayers",
        Key: { name },
        UpdateExpression: "SET score = score + :inc",
        ExpressionAttributeValues: { ":inc": 1 },
      })
    );
  }

  /* 5) Gather live connections */
  const { Items = [] } = await doc.send(
    new ScanCommand({
      TableName: "LaserGamePlayers",
      ProjectionExpression: "connectionId, #nm",
      ExpressionAttributeNames: { "#nm": "name" },
      FilterExpression: "attribute_exists(connectionId)",
    })
  );

  /* 6) Broadcast result (incl. origin/dir for visuals) */
  const payload = JSON.stringify({
    action: "shootResult",
    shooter: name,
    hit: hitName ? { name: hitName } : null,
    origin,
    direction,
    message: hitName ? `Hit ${hitName}!` : "Miss!",
  });

  await broadcastToAll(apigw, Items, payload);
  return { statusCode: 200 };
}
