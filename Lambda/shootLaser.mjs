// shootLaser.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

/* -------------------------------------------------- *
 *  Constants – keep in sync with Game.js
 * -------------------------------------------------- */
const GRID_SIZE  = 135;
const SPACING    = 0.2;
const PLAYER_RAD = 0.5;

const ddb = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddb);

/* helper – broadcast payload to all live sockets */
async function broadcast(apigw, liveItems, payload) {
  await Promise.all(
    liveItems.map(async item => {
      if (!item.connectionId) return;
      try {
        await apigw.send(
          new PostToConnectionCommand({
            ConnectionId: item.connectionId,
            Data: payload,
          })
        );
      } catch (err) {
        if (
          err.name === "GoneException" ||
          err.$metadata?.httpStatusCode === 410
        ) {
          /* mark them offline */
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

/* ============================================================ */
export async function handler(event) {
  const { domainName, stage, connectionId } = event.requestContext;
  const apigw = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });

  /* ---------- 1) parse payload ---------- */
  let data = {};
  try {
    data = JSON.parse(event.body || "{}");
  } catch (_) {}
  const { name, origin, direction } = data;
  if (!name || !origin || !direction) {
    await apigw.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({
          action: "shootResult",
          error: "Invalid shoot payload",
        }),
      })
    );
    return { statusCode: 400 };
  }

  /* ---------- 2) ensure shooter exists ---------- */
  const shooter = await doc.send(
    new GetCommand({
      TableName: "LaserGamePlayers",
      Key: { name },
    })
  );
  if (!shooter.Item) {
    await apigw.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({
          action: "shootResult",
          error: "Player not found",
        }),
      })
    );
    return { statusCode: 200 };
  }

  /* ---------- 3) raycast vs every other player ---------- */
  const scan = await doc.send(new ScanCommand({ TableName: "LaserGamePlayers" }));

  const dir = direction; // already normalized by client
  let closestT  = Infinity;
  let hitPlayer = null;

  for (const p of scan.Items || []) {
    if (p.name === name) continue;   // don't hit yourself

    /* grid → world */
    const cx = (p.x - GRID_SIZE / 2 + 0.5) * SPACING;
    const baseY = typeof p.baseY === "number" ? p.baseY : 0;
    const cy = baseY + PLAYER_RAD;
    const cz = (p.y - GRID_SIZE / 2 + 0.5) * SPACING;

    /* origin→centre vector */
    const ocx = cx - origin.x;
    const ocy = cy - origin.y;
    const ocz = cz - origin.z;

    const tca = ocx * dir.x + ocy * dir.y + ocz * dir.z;
    if (tca < 0) continue; // behind shooter

    const d2 =
      ocx * ocx + ocy * ocy + ocz * ocz - tca * tca;
    if (d2 > PLAYER_RAD * PLAYER_RAD) continue;

    const thc  = Math.sqrt(PLAYER_RAD * PLAYER_RAD - d2);
    const tHit = tca - thc;
    if (tHit >= 0 && tHit < closestT) {
      closestT  = tHit;
      hitPlayer = p;
    }
  }

  /* ---------- 4) update score if hit ---------- */
  let shooterScore = shooter.Item.score ?? 0;
  if (hitPlayer) {
    const res = await doc.send(
      new UpdateCommand({
        TableName: "LaserGamePlayers",
        Key: { name },
        UpdateExpression: "SET score = score + :inc",
        ExpressionAttributeValues: { ":inc": 1 },
        ReturnValues: "UPDATED_NEW",
      })
    );
    shooterScore = res.Attributes?.score ?? shooterScore;
  }

  /* ---------- 5) gather live connections ---------- */
  const live = await doc.send(
    new ScanCommand({
      TableName: "LaserGamePlayers",
      ProjectionExpression: "connectionId, #nm",
      ExpressionAttributeNames: { "#nm": "name" },
      FilterExpression: "attribute_exists(connectionId)",
    })
  );

  /* ---------- 6) broadcast ---------- */
  const payload = JSON.stringify({
    action: "shootResult",
    shooter: name,
    shooterScore,
    hit: hitPlayer ? { name: hitPlayer.name } : null,
    origin,
    direction,
    message: hitPlayer ? `Hit ${hitPlayer.name}!` : "Miss!",
  });

  await broadcast(apigw, live.Items || [], payload);
  return { statusCode: 200 };
}
