// Dedicated Vercel function so Review Dynamic Batches hits Express even if /api catch-all is missing.
export { default } from "../../artifacts/api-server/deploy/app.mjs";
