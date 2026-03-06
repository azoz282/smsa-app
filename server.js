const path = require("path");
const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

const FIXED_ADDRESSES = {
  shipper: {
    ContactName: "MOHSEN saleh",
    ContactPhoneNumber: "966538641968",
    Country: "SA",
    District: "Bader",
    PostalCode: "14727",
    City: "Riyadh",
    AddressLine1: "7892, RLDA7892, Tariq Bin Ziyad, 4733, Irid",
    AddressLine2: ""
  },
  consignee: {
    ContactName: "HAFEDH",
    ContactPhoneNumber: "8613924177440",
    Country: "CN",
    District: "Liwan District",
    PostalCode: "",
    City: "Guangzhou",
    AddressLine1: "Room 1009, Building B2",
    AddressLine2: "Yuexiu Fortune Mansion"
  }
};

const smsaConfig = {
  baseUrl: process.env.SMSA_BASE_URL || "https://ecomapis.smsaexpress.com",
  apiKey: process.env.SMSA_API_KEY || "",
  serviceCode: process.env.SMSA_SERVICE_CODE || "",
  waybillType: process.env.SMSA_WAYBILL_TYPE || "PDF",
  shipmentCurrency: process.env.SMSA_CURRENCY || "SAR",
  smsaRetailId: process.env.SMSA_SMSA_RETAIL_ID || "0",
  vatPaid: parseBoolean(process.env.SMSA_VAT_PAID, true),
  dutyPaid: parseBoolean(process.env.SMSA_DUTY_PAID, false)
};

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (_req, res) => {
  res.json({
    fixedAddresses: FIXED_ADDRESSES,
    shippingDefaults: {
      weightUnit: "KG",
      parcels: 1,
      shipmentCurrency: smsaConfig.shipmentCurrency,
      serviceCode: smsaConfig.serviceCode
    },
    smsaReady: Boolean(smsaConfig.apiKey)
  });
});

app.post("/api/shipments/preview", (req, res) => {
  try {
    const input = validateShipmentInput(req.body);
    const summary = buildShipmentSummary(input);

    res.json(summary);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.post("/api/shipments/create", async (req, res) => {
  if (!smsaConfig.apiKey) {
    return res.status(400).json({
      message: "SMSA_API_KEY is missing. Add it to .env before creating shipments."
    });
  }

  try {
    const input = validateShipmentInput(req.body);
    const summary = buildShipmentSummary(input);
    const response = await fetch(`${smsaConfig.baseUrl}/api/shipment/b2c/new`, {
      method: "POST",
      headers: {
        apikey: smsaConfig.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(summary.payload)
    });

    const rawBody = await response.text();
    let parsedBody = rawBody;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch (_error) {
      // Keep raw text when SMSA returns non-JSON content.
    }

    if (!response.ok) {
      return res.status(response.status).json({
        message: "SMSA request failed.",
        smsaStatus: response.status,
        smsaResponse: parsedBody,
        payload: summary.payload
      });
    }

    const invoiceSummary = buildInvoiceSummary(input, summary, parsedBody);
    let invoiceResult = {
      success: false,
      skipped: true
    };

    if (invoiceSummary) {
      const invoiceResponse = await fetch(`${smsaConfig.baseUrl}/api/invoice`, {
        method: "POST",
        headers: {
          apikey: smsaConfig.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(invoiceSummary.payload)
      });

      const invoiceRawBody = await invoiceResponse.text();
      let invoiceParsedBody = invoiceRawBody;
      try {
        invoiceParsedBody = JSON.parse(invoiceRawBody);
      } catch (_error) {
        // Keep raw text when SMSA returns non-JSON content.
      }

      invoiceResult = {
        success: invoiceResponse.ok,
        skipped: false,
        smsaStatus: invoiceResponse.status,
        payload: invoiceSummary.payload,
        smsaResponse: invoiceParsedBody
      };
    }

    return res.json({
      message: "Shipment created successfully.",
      calculatedWeight: summary.calculatedWeight,
      payload: summary.payload,
      smsaResponse: parsedBody,
      invoiceResult
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`SMSA app listening on http://localhost:${port}`);
  });
}

function validateShipmentInput(body) {
  const requiredFields = [
    "orderNumber",
    "contentDescription",
    "declaredValue",
    "itemHSCode",
    "countryOfOrigin",
    "itemQuantity",
    "lengthCm",
    "widthCm",
    "heightCm"
  ];

  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      throw new Error(`Field "${field}" is required.`);
    }
  }

  const declaredValue = toPositiveNumber(body.declaredValue, "declaredValue");
  const itemHSCode = String(body.itemHSCode).trim();
  if (!itemHSCode) {
    throw new Error('Field "itemHSCode" is required.');
  }

  const countryOfOrigin = String(body.countryOfOrigin).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryOfOrigin)) {
    throw new Error('Field "countryOfOrigin" must be a valid 2-letter ISO country code.');
  }

  const itemQuantity = toInteger(body.itemQuantity, "itemQuantity");
  const lengthCm = toPositiveNumber(body.lengthCm, "lengthCm");
  const widthCm = toPositiveNumber(body.widthCm, "widthCm");
  const heightCm = toPositiveNumber(body.heightCm, "heightCm");
  const actualWeightKg = body.actualWeightKg === "" || body.actualWeightKg === undefined
    ? 0
    : toNonNegativeNumber(body.actualWeightKg, "actualWeightKg");

  return {
    orderNumber: String(body.orderNumber).trim(),
    contentDescription: String(body.contentDescription).trim(),
    declaredValue,
    itemHSCode,
    countryOfOrigin,
    itemQuantity,
    codAmount: body.codAmount === "" || body.codAmount === undefined
      ? 0
      : toNonNegativeNumber(body.codAmount, "codAmount"),
    parcels: body.parcels === "" || body.parcels === undefined
      ? 1
      : toInteger(body.parcels, "parcels"),
    shipDate: body.shipDate ? new Date(body.shipDate).toISOString() : new Date().toISOString(),
    lengthCm,
    widthCm,
    heightCm,
    actualWeightKg
  };
}

function buildShipmentSummary(input) {
  const volumetricWeightKg = roundTo3((input.lengthCm * input.widthCm * input.heightCm) / 5000);
  const calculatedWeight = roundTo3(Math.max(input.actualWeightKg, volumetricWeightKg));

  const payload = {
    ConsigneeAddress: FIXED_ADDRESSES.consignee,
    ShipperAddress: FIXED_ADDRESSES.shipper,
    OrderNumber: input.orderNumber,
    DeclaredValue: input.declaredValue,
    CODAmount: input.codAmount,
    Parcels: input.parcels,
    ShipDate: input.shipDate,
    ShipmentCurrency: smsaConfig.shipmentCurrency,
    WaybillType: smsaConfig.waybillType,
    Weight: calculatedWeight,
    WeightUnit: "KG",
    ContentDescription: input.contentDescription,
    VatPaid: smsaConfig.vatPaid,
    DutyPaid: smsaConfig.dutyPaid
  };

  if (smsaConfig.serviceCode) {
    payload.ServiceCode = smsaConfig.serviceCode;
  }

  if (smsaConfig.smsaRetailId) {
    payload.SMSARetailID = smsaConfig.smsaRetailId;
  }

  return {
    dimensionsCm: {
      length: input.lengthCm,
      width: input.widthCm,
      height: input.heightCm
    },
    actualWeightKg: input.actualWeightKg,
    volumetricWeightKg,
    calculatedWeight,
    payload
  };
}

function buildInvoiceSummary(input, shipmentSummary, smsaResponse) {
  const awb = extractAwb(smsaResponse);
  if (!awb) {
    return null;
  }

  return {
    payload: {
      AWB: awb,
      Currency: smsaConfig.shipmentCurrency,
      WeightUnit: "KG",
      InvoiceDate: formatInvoiceDate(input.shipDate),
      Items: [
        {
          Sequence: 1,
          ItemHSCode: input.itemHSCode,
          QuantityUnit: "UNIT",
          ItemReference: input.orderNumber,
          ItemDescription: input.contentDescription,
          Weight: shipmentSummary.calculatedWeight,
          ItemValue: input.declaredValue,
          Quantity: input.itemQuantity,
          CountryOfOrigin: input.countryOfOrigin
        }
      ]
    }
  };
}

function extractAwb(smsaResponse) {
  const awb = smsaResponse?.waybills?.[0]?.awb || smsaResponse?.sawb;
  return awb ? String(awb).trim() : "";
}

function formatInvoiceDate(value) {
  const date = new Date(value);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function toPositiveNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Field "${field}" must be a number greater than zero.`);
  }
  return parsed;
}

function toNonNegativeNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Field "${field}" must be a number greater than or equal to zero.`);
  }
  return parsed;
}

function toInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Field "${field}" must be an integer greater than zero.`);
  }
  return parsed;
}

function roundTo3(value) {
  return Math.round(value * 1000) / 1000;
}

function parseBoolean(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  return String(value).toLowerCase() === "true";
}

module.exports = app;
