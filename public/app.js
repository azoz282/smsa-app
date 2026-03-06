const elements = {
  form: document.getElementById("shipmentForm"),
  shipDateInput: document.querySelector('input[name="shipDate"]'),
  labelActions: document.getElementById("labelActions"),
  downloadLabelButton: document.getElementById("downloadLabelButton")
};

let latestLabel = null;

bootstrap();

async function bootstrap() {
  setDefaultShipDate();

  try {
    const response = await fetch("/api/config");
    await response.json();
  } catch (_error) {}
}

elements.downloadLabelButton.addEventListener("click", () => {
  if (!latestLabel) {
    return;
  }

  downloadBase64Pdf(latestLabel.base64, latestLabel.filename);
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setSubmitting(true);
  hideLabelDownload();

  try {
    const body = collectFormData();
    const response = await fetch("/api/shipments/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();

    if (!response.ok) {
      return;
    }

    prepareLabelDownload(data.smsaResponse);
  } catch (error) {
    hideLabelDownload();
  } finally {
    setSubmitting(false);
  }
});

function collectFormData() {
  const formData = new FormData(elements.form);
  return {
    orderNumber: "1000",
    codAmount: 0,
    actualWeightKg: 0,
    ...Object.fromEntries(formData.entries())
  };
}

function setSubmitting(isSubmitting) {
  elements.form.querySelector('button[type="submit"]').disabled = isSubmitting;
}

function setDefaultShipDate() {
  if (!elements.shipDateInput || elements.shipDateInput.value) {
    return;
  }

  const now = new Date();
  const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  elements.shipDateInput.value = localDateTime;
}

function prepareLabelDownload(smsaResponse) {
  const label = smsaResponse?.waybills?.[0];
  if (!label?.awbFile) {
    hideLabelDownload();
    return;
  }

  latestLabel = {
    base64: label.awbFile,
    filename: `SMSA-${label.awb || smsaResponse.sawb || "label"}.pdf`
  };

  elements.labelActions.hidden = false;
  downloadBase64Pdf(latestLabel.base64, latestLabel.filename);
}

function hideLabelDownload() {
  latestLabel = null;
  elements.labelActions.hidden = true;
}

function downloadBase64Pdf(base64, filename) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
