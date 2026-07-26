require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./src/db");

const app = express();
const PORT = process.env.PORT || 3000;
const METADATA_TIMEOUT_MS = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Helper to fetch and validate metadata from an instance
async function fetchAndValidateInstanceMetadata(instanceLink) {
  let metadataUrl;
  try {
    metadataUrl = new URL("/metadata", instanceLink).toString();
  } catch (err) {
    return { error: "Invalid instance link" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(metadataUrl, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return { error: `Instance metadata unreachable (status ${res.status})` };
    }
    const body = await res.text();
    if (!body || !body.trim()) {
      return { error: "Instance metadata endpoint returned empty response" };
    }
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      return { error: "Instance metadata endpoint did not return valid JSON" };
    }
    return { data: json };
  } catch (error) {
    clearTimeout(timeout);
    const reason = error.name === "AbortError" ? "timeout" : "fetch failed";
    return { error: `Failed to verify instance metadata: ${reason}` };
  }
}

// POST /registrations - Instance administrator registers their instance
app.post("/registrations", async (req, res) => {
  // Accept any metadata shape and filter what we need
  const metadata = req.body || {};

  const data = getRegistryData(metadata);

  const requiredMetaKeys = [
    "name",
    "link",
    "websocketLink",
    "region",
    "imageUrl",
    "userCount",
  ];
  const missing = requiredMetaKeys.filter(
    (k) => data[k] === undefined || data[k] === null,
  );
  if (missing.length) {
    return res
      .status(400)
      .json({ error: `Missing fields: ${missing.join(", ")}` });
  }

  // Use the new helper to fetch and validate metadata
  const metaResult = await fetchAndValidateInstanceMetadata(data.link);
  if (metaResult.error) {
    return res.status(400).json({ error: metaResult.error });
  }

  // Region should already be normalized to a geometry object (Polygon/MultiPolygon) by the client
  const regionGeoJson =
    data.region && typeof data.region === "object"
      ? JSON.stringify(data.region)
      : data.region;

  try {
    const result = await pool.query(
      `INSERT INTO instances 
       (name, link, websocket_link, region, image_url, user_count, status, last_fetched_at, created_at, updated_at) 
       VALUES ($1, $2, $3, CASE WHEN $4::text IS NULL THEN NULL ELSE ST_GeomFromGeoJSON($4::text) END, $5, $6, 'verified', NOW(), NOW(), $7)
       RETURNING 
         id,
         name,
         link,
         websocket_link,
         ST_AsGeoJSON(region) AS region_geojson,
         image_url,
         user_count,
         status,
         last_fetched_at,
         created_at,
         updated_at;`,
      [
        data.name,
        data.link,
        data.websocketLink,
        regionGeoJson,
        data.imageUrl || null,
        data.userCount || 0,
        data.updatedAt,
      ],
    );

    const row = result.rows[0];

    res.status(201).json({
      message: "Instance registered and verified successfully.",
      instance: {
        id: row.id,
        name: row.name,
        link: row.link,
        websocketLink: row.websocket_link,
        region: row.region_geojson ? JSON.parse(row.region_geojson) : null,
        imageUrl: row.image_url,
        userCount: row.user_count,
        status: row.status,
        lastFetchedAt: row.last_fetched_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Instance with this link already exists",
      });
    }
    console.error("Registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

function getRegistryData(metadata) {
  // Accepts metadata (from POST or /metadata) and returns all the expected columns as one shape
  const details = metadata.details ?? {};

  return {
    name: details.name ?? metadata.name,
    link: details.link ?? metadata.link,
    websocketLink: details.websocketLink ?? metadata.websocketLink,
    region: details.region ?? metadata.region ?? null,
    imageUrl: details.imageUrl ?? metadata.imageUrl ?? null,
    userCount: details.userCount ?? metadata.userCount ?? null,
    rulesUrl: details.rulesUrl ?? metadata.rulesUrl,
    descriptionUrl: details.descriptionUrl ?? metadata.descriptionUrl,
    termsOfServiceUrl: details.termsOfServiceUrl ?? metadata.termsOfServiceUrl,
    privacyPolicyUrl: details.privacyPolicyUrl ?? metadata.privacyPolicyUrl,
    // updatedAt comes from the top-level metadata (not inside details)
    updatedAt: metadata.updatedAt ?? null,
  };
}

const refreshInstanceMetadata = async (instanceRow) => {
  // Use the new helper to fetch and validate metadata
  const metaResult = await fetchAndValidateInstanceMetadata(instanceRow.link);
  if (metaResult.error) {
    console.warn(
      `Failed to fetch metadata for ${instanceRow.link}: ${metaResult.error}`,
    );
    return { ok: false, reason: "fetch-failed", message: metaResult.error };
  }
  const response = metaResult.data;
  console.log(response);

  const data = getRegistryData(response.result);
  const regionValue =
    data.region && typeof data.region === "object"
      ? JSON.stringify(data.region)
      : (data.region ?? null);

  try {
    await pool.query(
      `UPDATE instances
       SET
         name = COALESCE($1, name),
         websocket_link = COALESCE($2, websocket_link),
         region = ST_GeomFromGeoJSON($3),
         image_url = COALESCE($4, image_url),
         user_count = COALESCE($5, user_count),
         last_fetched_at = NOW(),
         updated_at = COALESCE($6, updated_at)
       WHERE link = $7;`,
      [
        data.name ?? instanceRow.name,
        data.websocketLink ?? instanceRow.websocket_link,
        regionValue ?? instanceRow.region_geojson,
        data.imageUrl ?? instanceRow.image_url,
        data.userCount ?? instanceRow.user_count,
        data.updatedAt,
        instanceRow.link,
      ],
    );
    return { ok: true };
  } catch (error) {
    const reason = error.name === "AbortError" ? "timeout" : "fetch-failed";
    console.warn(
      `Failed to refresh metadata for ${instanceRow.link}: ${reason} ${error.message || ""}`,
    );
    return { ok: false, reason, message: error.message };
  }
};

// GET /instances - Fetch list of verified instances for mobile app
app.get("/instances", async (req, res) => {
  const { lat, lng } = req.query;

  // Default coordinates: Princeton, NJ
  const DEFAULT_LAT = 40.344;
  const DEFAULT_LNG = -74.6514;

  // Use provided coordinates or fall back to default
  let latitude, longitude;

  if (lat !== undefined && lng !== undefined) {
    latitude = parseFloat(lat);
    longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({ error: "Invalid latitude or longitude" });
    }
  } else {
    latitude = DEFAULT_LAT;
    longitude = DEFAULT_LNG;
  }

  try {
    // Always sort by distance from coordinates (provided or default)
    const result = await pool.query(
      `SELECT 
        id,
        name,
        link,
        websocket_link,
        ST_AsGeoJSON(region) AS region_geojson,
        image_url,
        user_count,
        status,
        last_fetched_at,
        created_at,
        updated_at,
        ST_Distance(
          region::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) AS distance_meters
       FROM instances 
       WHERE status = 'verified'
       ORDER BY distance_meters ASC NULLS LAST;`,
      [longitude, latitude],
    );

    // Format response with camelCase for frontend
    const instances = result.rows.map((row) => ({
      registry: {
        id: row.id,
        status: row.status,
        createdAt: row.created_at,
        lastFetchedAt: row.last_fetched_at,
        distanceMeters: row.distance_meters,
      },
      details: {
        name: row.name,
        link: row.link,
        websocketLink: row.websocket_link,
        imageUrl: row.image_url,
        region: row.region_geojson ? JSON.parse(row.region_geojson) : null,
        userCount: row.user_count,
      },
      config: {},
      updatedAt: row.updated_at,
    }));

    res.json({
      instances,
      count: instances.length,
    });
  } catch (error) {
    console.error("Fetch instances error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /registrations - Fetch registration status for admin dashboard
app.get("/registrations", async (req, res) => {
  const { instanceLink } = req.query;

  if (!instanceLink) {
    return res
      .status(400)
      .json({ error: "instanceLink query parameter is required" });
  }

  try {
    const result = await pool.query(
      `SELECT 
        link,
        status,
        last_fetched_at,
        created_at
       FROM instances 
       WHERE link = $1
       LIMIT 1;`,
      [instanceLink],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Instance not found" });
    }

    const row = result.rows[0];

    res.json({
      instanceLink: row.link,
      status: row.status,
      reason: null,
      createdAt: row.created_at,
      lastFetchedAt: row.last_fetched_at,
    });
  } catch (error) {
    console.error("Fetch registration status error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /registrations/refresh - Trigger metadata refresh for a specific instance
app.post("/registrations/refresh", async (req, res) => {
  const { instanceLink } = req.body;

  if (!instanceLink) {
    return res
      .status(400)
      .json({ error: "instanceLink is required in request body" });
  }

  try {
    const result = await pool.query(
      `SELECT
        id,
        name,
        link,
        websocket_link,
        ST_AsGeoJSON(region) AS region_geojson,
        image_url,
        user_count,
        status,
        last_fetched_at,
        created_at,
        updated_at
       FROM instances
       WHERE link = $1
       LIMIT 1;`,
      [instanceLink],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Instance not found" });
    }

    const instance = result.rows[0];

    // fire-and-forget
    void refreshInstanceMetadata(instance);

    // 202 = accepted, processing async
    res.status(202).json({
      message: "Metadata refresh triggered",
    });
  } catch (error) {
    console.error("Refresh trigger error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /registrations - Remove an instance registration
app.delete("/registrations", async (req, res) => {
  const instanceLink = req.query.instancelink || req.query.instanceLink;

  if (!instanceLink) {
    return res
      .status(400)
      .json({ error: "instanceLink query parameter is required" });
  }

  try {
    const result = await pool.query(
      "DELETE FROM instances WHERE link = $1 RETURNING id;",
      [instanceLink],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Instance not found" });
    }

    res.json({ message: "Instance registration deleted" });
  } catch (error) {
    console.error("Delete registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Only listen when run directly (`node server.js`). Requiring this file from a test
// must not bind a port, or the test run never exits.
if (require.main === module) {
  startServer();
}

module.exports = { app, getRegistryData, fetchAndValidateInstanceMetadata };

// Start server
function startServer() {
  return app.listen(PORT, () => {
    console.log(`Registry server running on http://localhost:${PORT}`);
    console.log(`Available endpoints:`);
    console.log(`  POST /registrations - Register instance`);
    console.log(`  GET /instances - Get verified instances`);
    console.log(`  GET /registrations - Get registration status`);
    console.log(
      `  POST /registrations/refresh - Trigger metadata refresh for instance`,
    );
    console.log(`  DELETE /registrations - Remove instance registration`);
  });
}
