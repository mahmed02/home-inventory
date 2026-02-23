import { asRequiredText } from "../middleware/validation";
import { hashPassword } from "../auth/password";
import { pool } from "../db/pool";

function normalizeEmail(value: unknown): string | null {
  const normalized = asRequiredText(value)?.toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

async function run(): Promise<void> {
  const email = normalizeEmail(process.env.BOOTSTRAP_OWNER_EMAIL);
  const password = asRequiredText(process.env.BOOTSTRAP_OWNER_PASSWORD);
  const displayName = asRequiredText(process.env.BOOTSTRAP_OWNER_DISPLAY_NAME);
  const updateExistingPassword = process.env.BOOTSTRAP_OWNER_UPDATE_PASSWORD === "true";

  if (!email) {
    throw new Error("BOOTSTRAP_OWNER_EMAIL must be a valid email address");
  }
  if (!password) {
    throw new Error("BOOTSTRAP_OWNER_PASSWORD is required");
  }
  if (password.length < 8) {
    throw new Error("BOOTSTRAP_OWNER_PASSWORD must be at least 8 characters");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingUser = await client.query<{ id: string }>(
      `
      SELECT id
      FROM users
      WHERE email = $1
      LIMIT 1
      FOR UPDATE
      `,
      [email]
    );

    const passwordHash = hashPassword(password);
    let ownerUserId: string;

    if (existingUser.rowCount === 0) {
      const inserted = await client.query<{ id: string }>(
        `
        INSERT INTO users(email, password_hash, display_name)
        VALUES ($1, $2, $3)
        RETURNING id
        `,
        [email, passwordHash, displayName]
      );
      ownerUserId = inserted.rows[0].id;
    } else {
      ownerUserId = existingUser.rows[0].id;
      if (updateExistingPassword) {
        await client.query(
          `
          UPDATE users
          SET password_hash = $1
          WHERE id = $2
          `,
          [passwordHash, ownerUserId]
        );
      }
      if (displayName) {
        await client.query(
          `
          UPDATE users
          SET display_name = $1
          WHERE id = $2
          `,
          [displayName, ownerUserId]
        );
      }
    }

    const locationsUpdated = await client.query(
      `
      UPDATE locations
      SET owner_user_id = $1
      WHERE owner_user_id IS NULL
      `,
      [ownerUserId]
    );

    const itemsUpdated = await client.query(
      `
      UPDATE items
      SET owner_user_id = $1
      WHERE owner_user_id IS NULL
      `,
      [ownerUserId]
    );

    await client.query("COMMIT");

    console.log(
      JSON.stringify(
        {
          owner_user_id: ownerUserId,
          owner_email: email,
          assigned_locations: locationsUpdated.rowCount ?? 0,
          assigned_items: itemsUpdated.rowCount ?? 0,
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

run()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error("Bootstrap owner failed", error);
    await pool.end();
    process.exit(1);
  });
