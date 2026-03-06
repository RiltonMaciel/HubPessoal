"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { reportError } from "@/lib/errors";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    reportError(error, "app:error-boundary", { digest: error.digest });
  }, [error]);

  return (
    <section className="pageGrid" aria-label="Erro da aplicação">
      <Card className="col-12">
        <CardHeader>
          <div>
            <h3 style={{ margin: 0 }}>Ops — algo deu errado</h3>
            <small>Erro inesperado na interface</small>
          </div>
        </CardHeader>
        <CardBody>
          <p className="mini" style={{ marginTop: 0 }}>
            {error?.message ? error.message : "Erro desconhecido."}
          </p>

          <div className="chips" style={{ marginTop: 10 }}>
            <Button variant="primary" onClick={() => reset()}>Tentar novamente</Button>
            <Button onClick={() => router.back()}>← Voltar</Button>
            <Button onClick={() => router.push("/dashboard")}>Ir ao dashboard</Button>
          </div>
        </CardBody>
      </Card>
    </section>
  );
}
