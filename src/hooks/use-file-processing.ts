import { useState } from "react";
import type { MsgAttachment } from "@/lib/stream-chat";
import type { ChatAttachment } from "@/components/ChatInput";

export function useFileProcessing() {
  const [isProcessingPdf, setIsProcessingPdf] = useState(false);

  const compressImage = (file: File, maxDim = 1024, quality = 0.7): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl.split(",")[1]);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });

  const extractPdfText = async (file: File): Promise<string> => {
    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(" ");
        if (pageText.trim()) pages.push(`--- Página ${i} ---\n${pageText}`);
      }
      return pages.join("\n\n") || "(No se pudo extraer texto del PDF)";
    } catch (e) {
      console.error("PDF extraction error:", e);
      return "(Error al leer el PDF)";
    }
  };

  const processAttachments = async (
    chatAttachments?: ChatAttachment[]
  ): Promise<{ msgAttachments?: MsgAttachment[]; pdfTexts: string[] }> => {
    if (!chatAttachments?.length) return { pdfTexts: [] };

    const imageAtts = chatAttachments.filter((a) => a.file.type.startsWith("image/"));
    const pdfAtts = chatAttachments.filter((a) => a.file.type === "application/pdf");

    let msgAttachments: MsgAttachment[] | undefined;
    const pdfTexts: string[] = [];

    if (imageAtts.length) {
      msgAttachments = await Promise.all(
        imageAtts.map(async (a) => ({
          type: "image" as const,
          base64: await compressImage(a.file),
          mimeType: "image/jpeg",
          fileName: a.file.name,
        }))
      );
    }

    if (pdfAtts.length > 0) {
      setIsProcessingPdf(true);
      try {
        for (const att of pdfAtts) {
          const pdfText = await extractPdfText(att.file);
          pdfTexts.push(`📄 Documento "${att.file.name}":\n${pdfText}`);
        }
      } finally {
        setIsProcessingPdf(false);
      }

      // Add PDF file chips for display in the chat bubble
      if (!msgAttachments) msgAttachments = [];
      for (const att of pdfAtts) {
        msgAttachments.push({
          type: "file" as const,
          base64: "",
          mimeType: "application/pdf",
          fileName: att.file.name,
        });
      }
    }

    return { msgAttachments, pdfTexts };
  };

  return { isProcessingPdf, processAttachments };
}
