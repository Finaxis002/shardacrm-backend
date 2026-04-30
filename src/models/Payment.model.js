import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "INR",
    },
    paymentMode: {
      type: String,
      enum: [
        "UPI",
        "Bank Transfer",
        "Cash",
        "Cheque",
        "Razorpay",
        "Stripe",
        "PayU",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Partial", "Paid", "Overdue", "Cancelled"],
      default: "Pending",
    },
    reference: String, // Transaction ID / UTR
    paymentDate: Date,
    dueDate: Date,
    description: String,
    gateway: String, // Which payment gateway
    gatewayTransactionId: String,
    paymentLinkId: String,
    paymentLinkUrl: String,
    paymentLinkExpiry: Date,
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    metadata: mongoose.Schema.Types.Mixed, // Store gateway-specific data
  },
  { timestamps: true },
);

paymentSchema.index({ leadId: 1, createdAt: -1 });
paymentSchema.index({ organization: 1, status: 1 });

const Payment = mongoose.model("Payment", paymentSchema);
export default Payment;
