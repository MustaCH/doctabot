import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Upload, Loader2, FileSpreadsheet, CheckCircle, AlertTriangle, SkipForward, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import {
  ColumnMapping, ParsedClient, ParsedRow, RowState,
  computeRows, friendlyReason, ROW_ORDER,
} from "@/lib/import-contacts";

interface ImportClientsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onImported: () => void;
}

interface FailedRow {
  rowIndex: number;
  name: string;
  reason: string;
  data: ParsedClient;
}

type Destination = "contact" | "client";
type Step = "upload" | "mapping" | "preview" | "importing" | "done";

const clientTypeLabel: Record<string, string> = {
  buyer: "Comprador", seller: "Vendedor", both: "Ambos",
};

const statusOptions = [
  { value: "cold", label: "❄️ Frío" },
  { value: "warm", label: "☀️ Tibio" },
  { value: "hot", label: "🔥 Caliente" },
];

export default function ImportClientsDialog({ open, onOpenChange, userId, onImported }: ImportClientsDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [existing, setExisting] = useState<{ phones: Set<string>; emails: Set<string> }>({ phones: new Set(), emails: new Set() });
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [destination, setDestination] = useState<Destination>("contact");
  const [clientStatus, setClientStatus] = useState("cold");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [importResult, setImportResult] = useState({ success: 0, skipped: 0, invalid: 0, failed: [] as FailedRow[] });
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload");
    setFileName("");
    setUploadError("");
    setDragOver(false);
    setHeaders([]);
    setRows([]);
    setMapping(null);
    setExisting({ phones: new Set(), emails: new Set() });
    setParsedRows([]);
    setIncludeDuplicates(false);
    setDestination("contact");
    setClientStatus("cold");
    setProgress({ done: 0, total: 0 });
    setImportResult({ success: 0, skipped: 0, invalid: 0, failed: [] });
  };

  const handleClose = (next: boolean) => {
    if (!next) {
      if (step === "importing") return; // no cerrar a mitad de un import
      reset();
    }
    onOpenChange(next);
  };

  const parseFile = async (file: File) => {
    setUploadError("");
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx", "xls"].includes(ext ?? "")) {
      setUploadError(`Ese archivo es .${ext ?? "?"}, necesito CSV, XLSX o XLS.`);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setUploadError("El archivo supera los 20MB.");
      return;
    }

    setFileName(file.name);
    setStep("mapping");

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      if (jsonData.length < 2) {
        setStep("upload");
        setUploadError("El archivo debe tener al menos un encabezado y una fila de datos.");
        return;
      }

      const fileHeaders = jsonData[0].map(String);
      const fileRows = jsonData.slice(1).filter(row => row.some(cell => String(cell).trim() !== "")).map(r => r.map(String));

      if (fileRows.length === 0) {
        setStep("upload");
        setUploadError("El archivo no contiene datos.");
        return;
      }

      setHeaders(fileHeaders);
      setRows(fileRows);

      const sampleRows = fileRows.slice(0, 5);
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-client-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headers: fileHeaders, sampleRows }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al analizar el archivo");
      }

      const { mapping: aiMapping } = await res.json() as { mapping: ColumnMapping };

      // Traer contactos existentes para detectar duplicados (scopeado por userId).
      const existingKeys = { phones: new Set<string>(), emails: new Set<string>() };
      try {
        const { data } = await supabase.from("clients").select("phone, email").eq("user_id", userId);
        (data ?? []).forEach(c => {
          const p = normalizePhone(c.phone);
          if (p) existingKeys.phones.add(p);
          const e = normalizeEmail(c.email);
          if (e) existingKeys.emails.add(e);
        });
      } catch {
        // Si falla, seguimos con detección intra-archivo solamente.
      }

      setMapping(aiMapping);
      setExisting(existingKeys);
      setParsedRows(computeRows(fileHeaders, fileRows, aiMapping, existingKeys, false));
      setStep("preview");
    } catch (err) {
      setStep("upload");
      setUploadError(err instanceof Error ? err.message : "Error al procesar el archivo");
    }
  };

  const updateMapping = (field: keyof ColumnMapping, value: number) => {
    if (!mapping) return;
    const next = { ...mapping, [field]: value } as ColumnMapping;
    setMapping(next);
    setParsedRows(computeRows(headers, rows, next, existing, includeDuplicates));
  };

  const toggleIncludeDuplicates = () => {
    const next = !includeDuplicates;
    setIncludeDuplicates(next);
    setParsedRows(prev => prev.map(r => r.state === "duplicate" ? { ...r, included: next } : r));
  };

  const toggleRow = (rowIndex: number) => {
    setParsedRows(prev => prev.map(r =>
      r.rowIndex === rowIndex && r.state !== "invalid" ? { ...r, included: !r.included } : r,
    ));
  };

  const toPayload = (data: ParsedClient) => ({
    ...data,
    user_id: userId,
    is_client: destination === "client",
    status: destination === "client" ? clientStatus : "cold",
  });

  const runInsert = async (toImport: ParsedRow[]) => {
    const failed: FailedRow[] = [];
    let success = 0;
    const BATCH = 20;
    for (let i = 0; i < toImport.length; i += BATCH) {
      const slice = toImport.slice(i, i + BATCH);
      const { error } = await supabase.from("clients").insert(slice.map(r => toPayload(r.data)));
      if (error) {
        // Aislamiento: reintentar fila por fila para saber exactamente cuál falló.
        for (const r of slice) {
          const { error: rowErr } = await supabase.from("clients").insert(toPayload(r.data));
          if (rowErr) failed.push({ rowIndex: r.rowIndex, name: r.data.full_name, reason: friendlyReason(rowErr.message), data: r.data });
          else success++;
          setProgress(p => ({ ...p, done: p.done + 1 }));
        }
      } else {
        success += slice.length;
        setProgress(p => ({ ...p, done: p.done + slice.length }));
      }
    }
    return { success, failed };
  };

  const handleImport = async () => {
    const toImport = parsedRows.filter(r => r.included && r.state !== "invalid");
    const skipped = parsedRows.filter(r => r.state === "duplicate" && !r.included).length;
    const invalid = parsedRows.filter(r => r.state === "invalid").length;

    setStep("importing");
    setProgress({ done: 0, total: toImport.length });

    const { success, failed } = await runInsert(toImport);

    setImportResult({ success, skipped, invalid, failed });
    setStep("done");
    if (success > 0) onImported();
  };

  const handleRetryFailed = async () => {
    const retry: ParsedRow[] = importResult.failed.map(f => ({ data: f.data, rowIndex: f.rowIndex, state: "new", included: true }));
    setStep("importing");
    setProgress({ done: 0, total: retry.length });

    const { success, failed } = await runInsert(retry);

    setImportResult(res => ({ ...res, success: res.success + success, failed }));
    setStep("done");
    if (success > 0) onImported();
  };

  // ---- Derivados para el render ----
  const columnOptions = headers.map((h, i) => ({ value: String(i), label: h || `Columna ${i + 1}` }));
  const newCount = parsedRows.filter(r => r.state === "new").length;
  const dupCount = parsedRows.filter(r => r.state === "duplicate").length;
  const invalidCount = parsedRows.filter(r => r.state === "invalid").length;
  const includedCount = parsedRows.filter(r => r.included && r.state !== "invalid").length;
  const nameUnmapped = !mapping || mapping.name_column < 0;
  const destinationNoun = destination === "client" ? "clientes" : "contactos";
  const sortedRows = [...parsedRows].sort((a, b) => ROW_ORDER[a.state] - ROW_ORDER[b.state]);
  const progressPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const failedGroups = Object.entries(
    importResult.failed.reduce<Record<string, number>>((acc, f) => { acc[f.reason] = (acc[f.reason] ?? 0) + 1; return acc; }, {}),
  );

  const renderMapSelect = (label: string, field: keyof ColumnMapping, allowNone: boolean) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <Select value={String((mapping?.[field] as number) ?? -1)} onValueChange={(v) => updateMapping(field, Number(v))}>
        <SelectTrigger className={cn("h-8 w-[60%] text-xs", !allowNone && (mapping?.[field] as number) < 0 && "border-warning text-warning")}>
          <SelectValue placeholder="Elegir columna" />
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value="-1">— sin asignar</SelectItem>}
          {columnOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Importar contactos
            {(step === "upload" || step === "preview") && (
              <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
                Paso {step === "upload" ? "1" : "2"}/2
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* STEP: Upload */}
          {step === "upload" && (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
              <div
                className={cn(
                  "w-full rounded-2xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
                  dragOver ? "border-primary bg-primary/5" : uploadError ? "border-destructive/50 bg-destructive/5" : "border-border hover:border-primary/50",
                )}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) parseFile(file);
                }}
              >
                <Upload className={cn("h-10 w-10 mx-auto mb-3", dragOver ? "text-primary" : "text-muted-foreground/40")} />
                <p className="text-sm font-medium">Arrastrá tu archivo acá o hacé clic para elegirlo</p>
                <p className="text-xs text-muted-foreground mt-1">CSV, XLSX o XLS · máx. 20MB</p>
              </div>

              {uploadError && (
                <div className="flex items-center gap-1.5 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {uploadError}
                </div>
              )}

              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) parseFile(file);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {/* STEP: Mapping (loading) */}
          {step === "mapping" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Analizando columnas con IA…</p>
              <p className="text-xs text-muted-foreground">Identificando nombres, teléfonos y emails en "{fileName}"</p>
            </div>
          )}

          {/* STEP: Preview / hub */}
          {step === "preview" && mapping && (
            <div className="space-y-4">
              {/* Importar como */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium">Importar como:</span>
                <div className="inline-flex rounded-lg bg-muted p-1 gap-1">
                  {(["contact", "client"] as Destination[]).map(d => (
                    <button
                      key={d}
                      onClick={() => setDestination(d)}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                        destination === d ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                      )}
                    >
                      {d === "contact" ? "Contactos" : "Clientes"}
                    </button>
                  ))}
                </div>
                {destination === "client" && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Estado:</span>
                    <Select value={clientStatus} onValueChange={setClientStatus}>
                      <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {statusOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Columnas detectadas (editable) */}
              <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Columnas detectadas (tocá para corregir)</p>
                {renderMapSelect("👤 Nombre", "name_column", false)}
                {renderMapSelect("📱 Teléfono", "phone_column", true)}
                {renderMapSelect("📧 Email", "email_column", true)}
                {renderMapSelect("🏷️ Tipo", "client_type_column", true)}
                {nameUnmapped && (
                  <p className="text-xs text-warning">Elegí qué columna tiene el nombre para poder importar.</p>
                )}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {mapping.preferred_zones_column >= 0 && <Badge variant="secondary" className="text-[10px]">🏠 Zona → {headers[mapping.preferred_zones_column]}</Badge>}
                  {mapping.budget_max_column >= 0 && <Badge variant="secondary" className="text-[10px]">💰 Presup. → {headers[mapping.budget_max_column]}</Badge>}
                  {mapping.property_type_interest_column >= 0 && <Badge variant="secondary" className="text-[10px]">🏗️ Tipo prop → {headers[mapping.property_type_interest_column]}</Badge>}
                  {mapping.source_column >= 0 && <Badge variant="secondary" className="text-[10px]">📍 Fuente → {headers[mapping.source_column]}</Badge>}
                  {mapping.company_column >= 0 && <Badge variant="secondary" className="text-[10px]">🏢 Empresa → {headers[mapping.company_column]}</Badge>}
                  {mapping.extra_columns.length > 0 && <Badge variant="outline" className="text-[10px]">📝 +{mapping.extra_columns.length} cols → notas</Badge>}
                </div>
              </div>

              {/* Resumen */}
              <div className="flex flex-wrap gap-2">
                {newCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
                    <CheckCircle className="h-3.5 w-3.5" /> {newCount} nuevos
                  </span>
                )}
                {dupCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    <SkipForward className="h-3.5 w-3.5" /> {dupCount} ya existen{!includeDuplicates && " (excluidos)"}
                    <button onClick={toggleIncludeDuplicates} className="text-primary hover:underline ml-1">
                      {includeDuplicates ? "Excluir" : "Incluir igual"}
                    </button>
                  </span>
                )}
                {invalidCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" /> {invalidCount} sin nombre (no se importan)
                  </span>
                )}
              </div>

              {/* Tabla */}
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="max-h-[36vh] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead className="text-xs hidden sm:table-cell">#</TableHead>
                        <TableHead className="text-xs">Nombre</TableHead>
                        <TableHead className="text-xs hidden sm:table-cell">Tipo</TableHead>
                        <TableHead className="text-xs hidden md:table-cell">Teléfono</TableHead>
                        <TableHead className="text-xs">Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedRows.slice(0, 50).map((r) => (
                        <TableRow key={r.rowIndex} className={cn(!r.included && "opacity-50")}>
                          <TableCell className="py-1.5">
                            <Checkbox
                              checked={r.included}
                              disabled={r.state === "invalid"}
                              onCheckedChange={() => toggleRow(r.rowIndex)}
                              aria-label={`Incluir fila ${r.rowIndex}`}
                            />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">{r.rowIndex}</TableCell>
                          <TableCell className="text-xs font-medium max-w-[150px] truncate">
                            {r.data.full_name || <span className="italic text-muted-foreground">(sin nombre)</span>}
                          </TableCell>
                          <TableCell className="text-xs hidden sm:table-cell">
                            <Badge variant={r.data.client_type === "seller" ? "default" : r.data.client_type === "both" ? "outline" : "secondary"} className="text-[10px] px-1.5 py-0">
                              {clientTypeLabel[r.data.client_type] ?? r.data.client_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs max-w-[120px] truncate hidden md:table-cell">{r.data.phone ?? "—"}</TableCell>
                          <TableCell className="text-xs">
                            {r.state === "new" && <span className="inline-flex items-center gap-1 text-success"><CheckCircle className="h-3.5 w-3.5" /> Nuevo</span>}
                            {r.state === "duplicate" && <span className="inline-flex items-center gap-1 text-muted-foreground"><SkipForward className="h-3.5 w-3.5" /> Duplicado</span>}
                            {r.state === "invalid" && <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Sin nombre</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {parsedRows.length > 50 && (
                  <p className="text-xs text-muted-foreground text-center py-2 border-t border-border">
                    Problemas primero · mostrando 50 de {parsedRows.length}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* STEP: Importing */}
          {step === "importing" && (
            <div className="flex flex-col items-center justify-center gap-4 py-16 px-6">
              <p className="text-sm font-medium">Importando {destinationNoun}… <span className="tabular-nums">{progress.done}/{progress.total}</span></p>
              <Progress value={progressPct} className="h-2 w-full max-w-sm" />
            </div>
          )}

          {/* STEP: Done */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <CheckCircle className="h-12 w-12 text-success" />
              <p className="text-lg font-semibold">{importResult.success} {destinationNoun} importados</p>
              <div className="space-y-1.5 text-sm">
                {importResult.skipped > 0 && (
                  <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                    <SkipForward className="h-4 w-4" /> {importResult.skipped} omitidos (ya existían)
                  </div>
                )}
                {importResult.invalid > 0 && (
                  <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" /> {importResult.invalid} descartados (sin nombre)
                  </div>
                )}
                {importResult.failed.length > 0 && (
                  <div className="text-destructive">
                    <div className="flex items-center justify-center gap-1.5 font-medium">
                      <AlertTriangle className="h-4 w-4" /> {importResult.failed.length} no se pudieron importar
                    </div>
                    <ul className="text-xs mt-1 space-y-0.5">
                      {failedGroups.map(([reason, count]) => (
                        <li key={reason}>{reason} (×{count})</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === "upload" && (
            <Button variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={reset}>
                <X className="h-3.5 w-3.5 mr-1.5" /> Cancelar
              </Button>
              <Button onClick={handleImport} disabled={includedCount === 0 || nameUnmapped}>
                {includedCount === 0 ? "No hay nuevos para importar" : `Importar ${includedCount} ${destinationNoun}`}
              </Button>
            </>
          )}
          {step === "done" && (
            <>
              {importResult.failed.length > 0 && (
                <Button variant="outline" onClick={handleRetryFailed}>Reintentar fallidos</Button>
              )}
              <Button onClick={() => handleClose(false)}>Cerrar</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
