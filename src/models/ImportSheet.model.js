import mongoose from "mongoose";

const importSheetSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    label: String,
    sheetUrl: {
      type: String,
      required: true,
    },
    sheetId: String,
    columnMapping: {
      nameCol: String,
      phoneCol: String,
      emailCol: String,
      sourceCol: String,
      statusCol: String,
      valueCol: String,
    },
    defaultAssignTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    skipHeaderRows: {
      type: Number,
      default: 1,
    },
    importedLeadsCount: {
      type: Number,
      default: 0,
    },
    lastImportDate: Date,
    importStatus: {
      type: String,
      enum: ["pending", "importing", "completed", "failed"],
      default: "pending",
    },
    errorLog: String,
  },
  { timestamps: true },
);

const ImportSheet = mongoose.model("ImportSheet", importSheetSchema);
export default ImportSheet;
