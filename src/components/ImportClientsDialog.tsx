import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Upload, Loader2, FileSpreadsheet, CheckCircle, AlertTriangle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface ImportClientsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onImported: () => void;
}

interface ColumnMapping {
  name_column: number;
  phone_column: number;
  email_column: number;
  client_type_column: number;
  extra_columns: number[];
  has_name_split: boolean;
  name_column_2: number;
}

interface ParsedClient {
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  client_type: string;
  birthday?: string | null;
  company?: string | null;
  address?: string | null;
  preferred_zones?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  property_type_interest?: string | null;
  source?: string | null;
}

type Step = "upload" | "mapping" | "preview" | "importing" | "done";

/** Detect client_type from a raw cell value */
function detectClientType(val: string | null | undefined): string {
  if (!val) return "buyer";
  const lower = val.trim().toLowerCase();
  if (lower.includes("vendedor") || lower === "seller") return "seller";
  if (lower.includes("ambos") || lower === "both") return "both";
  return "buyer";
}

const clientTypeLabel: Record<string, string> = {
  buyer: "Comprador", seller: "Vendedor", both: "Ambos",
};

export default function ImportClientsDialog({ open, onOpenChange, userId, onImported }: ImportClientsDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [parsedClients, setParsedClients] = useState<ParsedClient[]>([]);
  const [importResult, setImportResult] = useState({ success: 0, errors: 0 });
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload");
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping(null);
    setParsedClients([]);
    setImportResult({ success: 0, errors: 0 });
    setLoading(false);
  };

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  const parseFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx", "xls"].includes(ext ?? "")) {
      toast.error("Formato no soportado. Usá CSV, XLSX o XLS.");
      return;
    }

    setFileName(file.name);
    setLoading(true);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      if (jsonData.length < 2) {
        toast.error("El archivo debe tener al menos un encabezado y una fila de datos.");
        setLoading(false);
        return;
      }

      const fileHeaders = jsonData[0].map(String);
      const fileRows = jsonData.slice(1).filter(row => row.some(cell => String(cell).trim() !== ""));

      if (fileRows.length === 0) {
        toast.error("El archivo no contiene datos.");
        setLoading(false);
        return;
      }

      setHeaders(fileHeaders);
      setRows(fileRows.map(r => r.map(String)));

      // Send to AI for column mapping
      setStep("mapping");
      const sampleRows = fileRows.slice(0, 5).map(r => r.map(String));

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
      setMapping(aiMapping);

      // Apply mapping to all rows
      const clients = applyMapping(fileHeaders, fileRows.map(r => r.map(String)), aiMapping);
      setParsedClients(clients);
      setStep("preview");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al procesar el archivo");
      setStep("upload");
    } finally {
      setLoading(false);
    }
  };

  const applyMapping = (hdrs: string[], dataRows: string[][], m: ColumnMapping): ParsedClient[] => {
    return dataRows.map(row => {
      let name = row[m.name_column]?.trim() ?? "";
      if (m.has_name_split && m.name_column_2 >= 0 && m.name_column_2 < row.length) {
        const part2 = row[m.name_column_2]?.trim() ?? "";
        name = `${name} ${part2}`.trim();
      }

      const phone = m.phone_column >= 0 ? (row[m.phone_column]?.trim() || null) : null;
      const email = m.email_column >= 0 ? (row[m.email_column]?.trim() || null) : null;

      // Detect client_type from mapped column
      let client_type = "buyer";
      if (m.client_type_column >= 0) {
        client_type = detectClientType(row[m.client_type_column]);
      }

      // Build notes from extra columns
      const noteParts: string[] = [];
      for (const idx of m.extra_columns) {
        const val = row[idx]?.trim();
        if (val) {
          noteParts.push(`${hdrs[idx]}: ${val}`);
        }
      }
      const notes = noteParts.length > 0 ? noteParts.join("\n") : null;

      // Fallback: if no client_type_column was detected, check notes for "Vendedor"
      if (m.client_type_column < 0 && notes) {
        if (/tipo\s*de\s*contacto\s*:\s*vendedor/i.test(notes)) {
          client_type = "seller";
        } else if (/tipo\s*de\s*contacto\s*:\s*ambos/i.test(notes)) {
          client_type = "both";
        }
      }

      return { full_name: name, phone, email, notes, client_type };
    }).filter(c => c.full_name.length > 0);
  };

  const handleImport = async () => {
    setStep("importing");
    setLoading(true);
    let success = 0;
    let errors = 0;

    // Insert in batches of 20
    const BATCH = 20;
    for (let i = 0; i < parsedClients.length; i += BATCH) {
      const batch = parsedClients.slice(i, i + BATCH).map(c => ({
        ...c,
        user_id: userId,
        status: "hot",
      }));

      const { error } = await supabase.from("clients").insert(batch);
      if (error) {
        console.error("Import batch error:", error);
        errors += batch.length;
      } else {
        success += batch.length;
      }
    }

    setImportResult({ success, errors });
    setStep("done");
    setLoading(false);
    if (success > 0) onImported();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Importar clientes
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* STEP: Upload */}
          {step === "upload" && (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-medium">Arrastrá o hacé clic para subir</p>
                <p className="text-xs text-muted-foreground mt-1">CSV, XLSX o XLS (máx. 20MB)</p>
              </div>
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
              <p className="text-sm font-medium">Analizando columnas con IA...</p>
              <p className="text-xs text-muted-foreground">Identificando nombres, teléfonos y emails en "{fileName}"</p>
            </div>
          )}

          {/* STEP: Preview */}
          {step === "preview" && mapping && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{parsedClients.length} clientes detectados</p>
                  <p className="text-xs text-muted-foreground">de {fileName}</p>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <Badge variant="secondary">
                    👤 Nombre → {headers[mapping.name_column]}
                    {mapping.has_name_split && mapping.name_column_2 >= 0 && ` + ${headers[mapping.name_column_2]}`}
                  </Badge>
                  {mapping.phone_column >= 0 && (
                    <Badge variant="secondary">📱 Tel → {headers[mapping.phone_column]}</Badge>
                  )}
                  {mapping.email_column >= 0 && (
                    <Badge variant="secondary">📧 Email → {headers[mapping.email_column]}</Badge>
                  )}
                  {mapping.client_type_column >= 0 && (
                    <Badge variant="secondary">🏷️ Tipo → {headers[mapping.client_type_column]}</Badge>
                  )}
                  {mapping.extra_columns.length > 0 && (
                    <Badge variant="outline">📝 +{mapping.extra_columns.length} cols en notas</Badge>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="max-h-[40vh] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">#</TableHead>
                        <TableHead className="text-xs">Nombre</TableHead>
                        <TableHead className="text-xs">Tipo</TableHead>
                        <TableHead className="text-xs">Teléfono</TableHead>
                        <TableHead className="text-xs">Email</TableHead>
                        <TableHead className="text-xs">Notas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedClients.slice(0, 50).map((c, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="text-xs font-medium max-w-[150px] truncate">{c.full_name}</TableCell>
                          <TableCell className="text-xs">
                            <Badge variant={c.client_type === "seller" ? "destructive" : c.client_type === "both" ? "outline" : "secondary"} className="text-[10px] px-1.5 py-0">
                              {clientTypeLabel[c.client_type] ?? c.client_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs max-w-[120px] truncate">{c.phone ?? "—"}</TableCell>
                          <TableCell className="text-xs max-w-[150px] truncate">{c.email ?? "—"}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate text-muted-foreground">{c.notes ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {parsedClients.length > 50 && (
                  <p className="text-xs text-muted-foreground text-center py-2 border-t border-border">
                    Mostrando 50 de {parsedClients.length} clientes
                  </p>
                )}
              </div>
            </div>
          )}

          {/* STEP: Importing */}
          {step === "importing" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Importando {parsedClients.length} clientes...</p>
            </div>
          )}

          {/* STEP: Done */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <CheckCircle className="h-12 w-12 text-emerald-500" />
              <p className="text-lg font-semibold">{importResult.success} clientes importados</p>
              {importResult.errors > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  {importResult.errors} no se pudieron importar
                </div>
              )}
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
                <X className="h-3.5 w-3.5 mr-1.5" />
                Cancelar
              </Button>
              <Button onClick={handleImport} disabled={parsedClients.length === 0}>
                Importar {parsedClients.length} clientes
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={() => handleClose(false)}>Cerrar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
