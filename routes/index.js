const express = require("express");
const router = express.Router();
const multer = require("multer");

// SET STORAGE
var storageLocal = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads");
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + "-" + Date.now() + "-" + file.originalname);
  },
});

var upload = multer({ storage: storageLocal });

const projectId = "insw-ocr";
const location = "us"; // Format is 'us' or 'eu'
const bucketName = "insw-ocr-bucket";

const { Storage } = require("@google-cloud/storage");
const storage = new Storage();

const {
  DocumentUnderstandingServiceClient,
} = require("@google-cloud/documentai");
const client = new DocumentUnderstandingServiceClient();

let fullText = "";

router.delete("/", function (req, res) {
  let deletedFiles = deleteFiles(res);
  deletedFiles
    .then((files) => {
      console.log("deletedFiles", files[0]);
      res.json({ message: "DELETE ALL", deleted_files: files[0] });
    })
    .catch((error) => {
      res.json({ message: error });
    });
});

/* GET home page. */
router.get("/", function (req, res) {
  res.json({ message: "WELCOME" });
});
router.post("/", upload.single("file"), (req, res, next) => {
  const file = req.file;
  if (!file) {
    const error = new Error("Please upload a file");
    error.httpStatusCode = 400;
    return next(error);
  }
  const fileName = file.filename;
  const filePath = file.path;
  uploadFile(res, filePath, fileName);
});

/*google storage*/
async function deleteFiles(res) {
  const bucket = storage.bucket(bucketName);
  let files = await bucket.getFiles();

  files[0].forEach(async (file) => {
    await bucket.file(file.name).delete();
  });
  return files;
}
async function uploadFile(res, filePath, fileName) {
  // Uploads a local file to the bucket
  await storage.bucket(bucketName).upload(filePath, {});
  const filePathGS = `${bucketName}/${fileName}`;
  // console.log(gcsInputUri);
  generate(res, filePathGS);
}
/*google storage*/

/*google document AI*/
async function generate(res, filePath) {
  // Configure the request for processing the PDF
  const parent = `projects/${projectId}/locations/${location}`;
  const gcsInputUri = `gs://${filePath}`;

  const request = {
    parent,
    inputConfig: {
      gcsSource: {
        uri: gcsInputUri,
      },
      mimeType: "application/pdf",
    },
    tableExtractionParams: {
      enabled: true,
    },
  };

  // Recognizes text entities in the PDF document
  const [result] = await client.processDocument(request);

  // Get all of the document text as one big string
  const { text } = result;
  // res.send(result);
  fullText = text;

  // Process the output
  const responseJson = {};

  //for table
  const [page1] = result.pages;
  const pages = result.pages;
  const responseTable = parsingTable(pages);
  responseJson["file_url"] = "https://storage.cloud.google.com/" + filePath;
  responseJson["data_table"] = responseTable;

  //for form
  const responseForm = parsingForm(pages);
  responseJson["data_form"] = responseForm;

  //fulltext process
  const responseText = fullText.split("\n");
  responseJson["data_text"] = responseText;
  responseJson["raw"] = result;
  res.send(responseJson);
}

function getText(textAnchor) {
  if (textAnchor.textSegments.length > 0) {
    const startIndex = textAnchor.textSegments[0].startIndex || 0;
    const endIndex = textAnchor.textSegments[0].endIndex;

    return fullText.substring(startIndex, endIndex);
  }
  return "[NO TEXT]";
}

function parsingForm(pages) {
  const formInPages = [];
  let responseForm = [];
  pages.forEach((page, pageIndex) => {
    const { formFields } = page;
    responseForm = [];
    for (const field of formFields) {
      const fieldName = getText(field.fieldName.textAnchor);
      const fieldNameBoundinng = field.fieldName.boundingPoly;
      const fieldValue = getText(field.fieldValue.textAnchor);
      const fieldValueBoundinng = field.fieldValue.boundingPoly;
      responseForm.push({
        key: fieldName,
        keyBoundingPoly: fieldNameBoundinng,
        value: fieldValue,
        valueBoundingPoly: fieldValueBoundinng,
      });
    }
    formInPages[pageIndex] = responseForm;
  });
  return formInPages;
}

function parsingTable(pages) {
  const tableInPages = [];
  let responseTable = [];
  pages.forEach((page, pageIndex) => {
    const tables = page.tables;
    console.log("pageIndex", pageIndex);
    responseTable = [];

    tables.forEach((table, index) => {
      const [headerRow] = table.headerRows;
      const headerResponse = [];

      for (const tableCell of headerRow.cells) {
        if (tableCell.layout.textAnchor.textSegments) {
          const textAnchor = tableCell.layout.textAnchor;
          const text = getText(textAnchor);
          headerResponse.push(text);
        }
      }

      const bodyRows = table.bodyRows;
      const bodyResponse = [];
      bodyRows.forEach((row) => {
        for (const tableCell of row.cells) {
          if (tableCell.layout.textAnchor.textSegments) {
            const textAnchor = tableCell.layout.textAnchor;
            const text = getText(textAnchor);
            bodyResponse.push(text);
          }
        }
      });
      const tableResponse = {
        header: headerResponse,
        body: bodyResponse,
      };
      responseTable[index] = tableResponse;
    });
    tableInPages[pageIndex] = responseTable;
  });

  return tableInPages;
}
/*google document AI*/
module.exports = router;
