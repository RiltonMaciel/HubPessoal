"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { db } from "@/lib/db";
import { createMasterSecret, deriveAesKey, validateMasterSecret } from "@/lib/crypto";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";

export default function SecureGatePage() {
  const { secureUnlocked, unlockSecure, lockSecure } = useAppStore();
  const [password, setPassword] = useState("");
  const [hasMaster, setHasMaster] = useState(false);
  const [message, setMessage] = useState("");
  const [autoLockMinutes, setAutoLockMinutes] = useState(5);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    void (async () => {
      const master = await db.secureMeta.get("master");
      setHasMaster(Boolean(master));
    })();
  }, []);

  useEffect(() => {
    if (!secureUnlocked) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      lockSecure();
      setMessage("Sessão bloqueada automaticamente.");
    }, autoLockMinutes * 60 * 1000);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [secureUnlocked, autoLockMinutes, lockSecure]);

  const submit = async () => {
    if (!password) return;

    if (!hasMaster) {
      const secret = await createMasterSecret(password);
      await db.secureMeta.put({ key: "master", value: JSON.stringify(secret) });
      const key = await deriveAesKey(password, secret.salt);
      unlockSecure(key);
      setHasMaster(true);
      setMessage("Senha mestra criada e sessão desbloqueada.");
      return;
    }

    const master = await db.secureMeta.get("master");
    if (!master) return;
    const parsed = JSON.parse(master.value) as { salt: string; verifier: string };
    const valid = await validateMasterSecret(password, parsed.salt, parsed.verifier);

    if (!valid) {
      setMessage("Senha inválida.");
      return;
    }

    const key = await deriveAesKey(password, parsed.salt);
    unlockSecure(key);
    setMessage("Área confidencial desbloqueada.");
  };

  return (
    <section className="pageGrid">
      <Card className="col-6" style={{ marginInline: "auto" }}>
        <CardHeader>
          <div><h3>Área Confidencial</h3><small>Dados criptografados localmente (PBKDF2 + AES-GCM)</small></div>
        </CardHeader>
        <CardBody>
          <div className="list">
            <input className="select" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={hasMaster ? "Informe a senha mestra" : "Crie sua senha mestra"} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
              <select className="select" value={autoLockMinutes} onChange={(event) => setAutoLockMinutes(Number(event.target.value))}>
                <option value={5}>Auto-lock em 5 min</option>
                <option value={10}>Auto-lock em 10 min</option>
                <option value={15}>Auto-lock em 15 min</option>
              </select>
              <Button variant="primary" onClick={() => void submit()}>{hasMaster ? "Desbloquear" : "Criar"}</Button>
            </div>

            {message && <div className="mini">{message}</div>}

            {secureUnlocked && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link className="btn" href="/secure/strategies">Strategies</Link>
                <Link className="btn" href="/secure/secret-notes">Secret Notes</Link>
                <Button onClick={() => lockSecure()}>Bloquear agora</Button>
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </section>
  );
}
