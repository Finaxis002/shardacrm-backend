import mongoose from "mongoose";
const { Schema } = mongoose;

const whatsappContactSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    // last-10-digit normalized phone — Lead.phone match karne ke liye isi format mein rakhte hain
    phone: { type: String, required: true, index: true },
    waName: { type: String, default: "" }, // WhatsApp pushname / contact ka khud set kiya naam
    profilePicUrl: { type: String, default: "" },
    profilePicUpdatedAt: { type: Date },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

whatsappContactSchema.index({ organization: 1, phone: 1 }, { unique: true });

export default mongoose.model("WhatsappContact", whatsappContactSchema);