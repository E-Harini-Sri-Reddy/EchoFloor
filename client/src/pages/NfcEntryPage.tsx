import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { machineByNfcTag } from "@/domain/queries";
import { useDemoDatabase } from "@/hooks/useDemo";
import { demoStore, getDatabase } from "@/services/demoStore";

export function NfcEntryPage() {
  const { tagId = "" } = useParams();
  const session = useDemoDatabase().session;
  const navigate = useNavigate();
  const [message, setMessage] = useState("Resolving the demonstration tag…");

  useEffect(() => {
    if (!session) {
      navigate("/", { replace: true });
      return;
    }
    const db = getDatabase();
    const machine = machineByNfcTag(db, session.organisationId, tagId);
    if (!machine) {
      setMessage(
        "This tag is not linked to a machine in your organisation. The tag is not a login.",
      );
      return;
    }
    if (!machine.nfc.enabled) {
      setMessage(
        `${machine.machineCode} has a disabled NFC mapping. Open the machine manually instead.`,
      );
      return;
    }
    const result = demoStore.selectMachine(machine.id);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    const voice = session.role === "admin" ? "/admin/voice" : "/worker/voice";
    navigate(`${voice}?machine=${machine.id}&source=nfc`, { replace: true });
  }, [navigate, session, tagId]);

  return (
    <main className="page">
      <div className="notice" role="status">
        <h1>NFC entry</h1>
        <p>{message}</p>
        <p>
          This is a demonstration link, not a physical tag scan. Possession of the link
          does not authenticate anyone.
        </p>
        <p style={{ marginTop: 12 }}>
          <Link
            to={
              session
                ? session.role === "admin"
                  ? "/admin/machines"
                  : "/worker/machines"
                : "/"
            }
          >
            Choose a machine manually
          </Link>
        </p>
      </div>
    </main>
  );
}
