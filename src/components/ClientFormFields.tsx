import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

export interface ClientFormData {
  full_name: string;
  phone: string;
  email: string;
  notes: string;
  status: string;
  client_type: string;
  birthday: string;
  company: string;
  address: string;
  preferred_zones: string;
  budget_min: string;
  budget_max: string;
  budget_currency: string;
  property_type_interest: string;
  source: string;
}

export const emptyClientForm: ClientFormData = {
  full_name: "",
  phone: "",
  email: "",
  notes: "",
  status: "hot",
  client_type: "buyer",
  birthday: "",
  company: "",
  address: "",
  preferred_zones: "",
  budget_min: "",
  budget_max: "",
  budget_currency: "USD",
  property_type_interest: "",
  source: "",
};

interface Props {
  form: ClientFormData;
  onChange: (form: ClientFormData) => void;
  showPlaceholders?: boolean;
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <label className="text-xs font-medium text-muted-foreground mb-1 block">{children}</label>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-semibold text-foreground/70 uppercase tracking-wider pt-1">{children}</p>
);

export default function ClientFormFields({ form, onChange, showPlaceholders }: Props) {
  const set = (key: keyof ClientFormData, value: string) => onChange({ ...form, [key]: value });
  const showBuyerFields = form.client_type === "buyer" || form.client_type === "both";

  return (
    <div className="space-y-4">
      {/* Personal */}
      <SectionTitle>Datos personales</SectionTitle>
      <div>
        <Label>Nombre *</Label>
        <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder={showPlaceholders ? "Nombre completo" : undefined} maxLength={100} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Teléfono</Label>
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder={showPlaceholders ? "+54 351 ..." : undefined} maxLength={30} />
        </div>
        <div>
          <Label>Email</Label>
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder={showPlaceholders ? "email@..." : undefined} maxLength={255} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Cumpleaños</Label>
          <Input type="date" value={form.birthday} onChange={(e) => set("birthday", e.target.value)} />
        </div>
        <div>
          <Label>Empresa / Ocupación</Label>
          <Input value={form.company} onChange={(e) => set("company", e.target.value)} placeholder={showPlaceholders ? "Empresa S.A." : undefined} maxLength={100} />
        </div>
      </div>
      <div>
        <Label>Dirección</Label>
        <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder={showPlaceholders ? "Dirección actual del cliente" : undefined} maxLength={200} />
      </div>

      <Separator />

      {/* Type & Status */}
      <SectionTitle>Tipo y estado</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>Tipo</Label>
          <Select value={form.client_type} onValueChange={(v) => set("client_type", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="buyer">🔍 Comprador</SelectItem>
              <SelectItem value="seller">🏠 Vendedor</SelectItem>
              <SelectItem value="both">↔️ Ambos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Estado</Label>
          <Select value={form.status} onValueChange={(v) => set("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prospect">Prospecto</SelectItem>
              <SelectItem value="active">Activo</SelectItem>
              <SelectItem value="inactive">Inactivo</SelectItem>
              <SelectItem value="closed">Cerrado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Fuente</Label>
          <Select value={form.source || "__none__"} onValueChange={(v) => set("source", v === "__none__" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">—</SelectItem>
              <SelectItem value="referido">Referido</SelectItem>
              <SelectItem value="portal">Portal</SelectItem>
              <SelectItem value="redes">Redes sociales</SelectItem>
              <SelectItem value="cartel">Cartel</SelectItem>
              <SelectItem value="otro">Otro</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Buyer preferences */}
      {showBuyerFields && (
        <>
          <Separator />
          <SectionTitle>Preferencias de búsqueda</SectionTitle>
          <div>
            <Label>Zonas de interés</Label>
            <Input value={form.preferred_zones} onChange={(e) => set("preferred_zones", e.target.value)} placeholder={showPlaceholders ? "Nueva Córdoba, Cerro, ..." : undefined} maxLength={300} />
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <div>
              <Label>Presupuesto mín.</Label>
              <Input type="number" value={form.budget_min} onChange={(e) => set("budget_min", e.target.value)} placeholder={showPlaceholders ? "50000" : undefined} />
            </div>
            <div>
              <Label>Presupuesto máx.</Label>
              <Input type="number" value={form.budget_max} onChange={(e) => set("budget_max", e.target.value)} placeholder={showPlaceholders ? "150000" : undefined} />
            </div>
            <div>
              <Label>Moneda</Label>
              <Select value={form.budget_currency} onValueChange={(v) => set("budget_currency", v)}>
                <SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="ARS">ARS</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Tipo de propiedad buscada</Label>
            <Input value={form.property_type_interest} onChange={(e) => set("property_type_interest", e.target.value)} placeholder={showPlaceholders ? "Departamento 2 amb., Casa, ..." : undefined} maxLength={200} />
          </div>
        </>
      )}

      <Separator />

      {/* Notes */}
      <div>
        <Label>Notas</Label>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder={showPlaceholders ? "Observaciones sobre el cliente..." : undefined} rows={3} maxLength={1000} />
      </div>
    </div>
  );
}
