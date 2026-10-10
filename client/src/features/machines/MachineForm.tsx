import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { useDemoDatabase } from "@/hooks/useDemo";
import { apiCreateMachine, apiUpdateMachine } from "@/services/apiClient";
import { demoStore } from "@/services/demoStore";
import type { Machine } from "@/types/domain";

const empty = {
  machineCode: "",
  name: "",
  description: "",
  productionLine: "",
  area: "",
  machineType: "",
  nfcTagId: "",
};

function valuesFromMachine(machine: Machine) {
  return {
    machineCode: machine.machineCode,
    name: machine.name,
    description: machine.description ?? "",
    productionLine: machine.location.productionLine ?? "",
    area: machine.location.area ?? "",
    machineType: machine.machineType ?? "",
    nfcTagId: machine.nfc.tagId ?? "",
  };
}

export function MachineForm({
  machine,
  onSaved,
  onCancel,
}: {
  machine?: Machine;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const toast = useToast();
  const session = useDemoDatabase().session;
  const [values, setValues] = useState(machine ? valuesFromMachine(machine) : empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValues(machine ? valuesFromMachine(machine) : empty);
    setErrors({});
  }, [machine?.id, machine?.updatedAt]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);

    if (session?.live) {
      const workspace = machine
        ? await apiUpdateMachine(machine.id, {
            organisationId: session.organisationId,
            updatedBy: session.userId,
            ...values,
          })
        : await apiCreateMachine({
            organisationId: session.organisationId,
            createdBy: session.userId,
            ...values,
          });
      setSaving(false);
      if (!workspace) {
        toast.push(
          machine
            ? "Could not update the machine in the database."
            : "Could not save the machine to the database.",
        );
        return;
      }
      demoStore.hydrateLive(workspace, session);
      setErrors({});
      if (!machine) setValues(empty);
      toast.push(machine ? "Machine updated in the database." : "Machine saved to the database.");
      onSaved?.();
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 300));
    const result = machine
      ? demoStore.updateMachine(machine.id, values)
      : demoStore.createMachine(values);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast.push(result.message);
      return;
    }
    setErrors({});
    toast.push(
      machine
        ? "Machine updated in this browser session."
        : "Machine saved in this browser session. It was not written to MongoDB.",
    );
    if (!machine) setValues(empty);
    onSaved?.();
  }

  function set<K extends keyof typeof values>(key: K, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <form className="card form-grid" onSubmit={onSubmit} noValidate>
      <h3>{machine ? `Edit ${machine.machineCode}` : "Add a machine"}</h3>
      <Field
        label="Machine identifier"
        htmlFor={`${machine?.id ?? "new"}-code`}
        error={errors.machineCode}
      >
        <TextInput
          id={`${machine?.id ?? "new"}-code`}
          value={values.machineCode}
          error={errors.machineCode}
          onChange={(event) => set("machineCode", event.target.value)}
        />
      </Field>
      <Field label="Name" htmlFor={`${machine?.id ?? "new"}-name`} error={errors.name}>
        <TextInput
          id={`${machine?.id ?? "new"}-name`}
          value={values.name}
          error={errors.name}
          onChange={(event) => set("name", event.target.value)}
        />
      </Field>
      <Field label="Production line" htmlFor={`${machine?.id ?? "new"}-line`}>
        <TextInput
          id={`${machine?.id ?? "new"}-line`}
          value={values.productionLine}
          onChange={(event) => set("productionLine", event.target.value)}
        />
      </Field>
      <Field label="Area" htmlFor={`${machine?.id ?? "new"}-area`}>
        <TextInput
          id={`${machine?.id ?? "new"}-area`}
          value={values.area}
          onChange={(event) => set("area", event.target.value)}
        />
      </Field>
      <Field label="Machine type" htmlFor={`${machine?.id ?? "new"}-type`}>
        <TextInput
          id={`${machine?.id ?? "new"}-type`}
          value={values.machineType}
          onChange={(event) => set("machineType", event.target.value)}
        />
      </Field>
      <Field
        label="NFC tag identifier"
        htmlFor={`${machine?.id ?? "new"}-nfc`}
        error={errors.nfcTagId}
        hint="Optional. A tag identifies a machine. It does not sign anyone in."
      >
        <TextInput
          id={`${machine?.id ?? "new"}-nfc`}
          value={values.nfcTagId}
          error={errors.nfcTagId}
          onChange={(event) => set("nfcTagId", event.target.value)}
        />
      </Field>
      <Field label="Description" htmlFor={`${machine?.id ?? "new"}-description`}>
        <textarea
          id={`${machine?.id ?? "new"}-description`}
          value={values.description}
          onChange={(event) => set("description", event.target.value)}
        />
      </Field>
      <div className="row">
        <Button type="submit" loading={saving}>
          {machine ? "Save machine" : "Register machine"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
