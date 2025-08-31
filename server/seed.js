// server/seed.js
import "dotenv/config.js";
import bcrypt from "bcrypt";
import { connectMongo } from "./services/db.js";
import Tenant from "./models/Tenant.js";
import User from "./models/User.js";
import Membership from "./models/Membership.js";

async function main() {
  await connectMongo();
  const tenant = await Tenant.findOneAndUpdate(
    { name: "Demo ISP" },
    { $setOnInsert: { name: "Demo ISP" } },
    { upsert: true, new: true }
  );

  const email = "owner@demo.isp";
  const passwordHash = await bcrypt.hash("ChangeMe123!", 12);
  const user =
    (await User.findOne({ email })) ||
    (await User.create({
      email,
      displayName: "Demo Owner",
      passwordHash,
      primaryTenant: tenant._id,
    }));

  await Membership.updateOne(
    { user: user._id, tenant: tenant._id },
    { $setOnInsert: { role: "owner" } },
    { upsert: true }
  );

  console.log("Seeded:", { tenant: String(tenant._id), user: email });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
