package com.meumercado.app;
import java.util.LinkedHashMap;
import java.util.Map;

/** Teste reproduz o relato: R$ 950 em saldos e R$ 300 em limite antigo. */
public final class BudgetSummaryTest {
    private static int count=0;
    static void eq(long e,long a,String label){count++;if(e!=a)throw new AssertionError(label+" esperado "+e+" atual "+a);}
    public static void main(String[] args){
        Map<String,Long> x=new LinkedHashMap<>();
        x.put("Vale-alimentação",60000L);
        x.put("Vale-refeição",25000L);
        x.put("Pix / Conta",0L);
        x.put("Dinheiro",10000L);
        x.put("Cartão de crédito",0L);
        BudgetSummary.Snapshot initial=BudgetSummary.calculate(x.values(),true,30000,0);
        eq(95000,initial.budget,"Orçamento deve ser R$ 950 e não R$ 300");
        eq(0,initial.spent,"Gasto sem produtos");
        eq(95000,initial.remaining,"Restante inicial");
        eq(95000,initial.totalBalances,"Soma dos saldos");
        x.put("Vale-alimentação",BalanceMath.add(x.get("Vale-alimentação"),5000));
        BudgetSummary.Snapshot recharged=BudgetSummary.calculate(x.values(),true,30000,0);
        eq(100000,recharged.budget,"Orçamento ao recarregar +R$ 50");
        eq(0,recharged.spent,"Recarga não conta como gasto");
        eq(100000,recharged.remaining,"Restante após a recarga");
        BudgetSummary.Snapshot cart=BudgetSummary.calculate(x.values(),true,30000,12590);
        eq(100000,cart.budget,"Orçamento com produtos");
        eq(12590,cart.spent,"Gasto com produtos");
        eq(87410,cart.remaining,"Restante com produtos");
        BudgetSummary.Snapshot manual=BudgetSummary.calculate(x.values(),false,30000,12590);
        eq(30000,manual.budget,"Modo manual conserva limite");
        eq(17410,manual.remaining,"Restante manual");
        x.put("Vale-alimentação",BalanceMath.debit(x.get("Vale-alimentação"),12590));
        BudgetSummary.Snapshot closed=BudgetSummary.calculate(x.values(),true,30000,0);
        eq(87410,closed.budget,"Orçamento após pagamento");
        eq(0,closed.spent,"Nova lista zera o gasto");
        eq(87410,closed.remaining,"Restante depois do pagamento");
        BudgetSummary.Snapshot over=BudgetSummary.calculate(x.values(),false,30000,45000);
        eq(-15000,over.remaining,"Excedente no modo manual");
        System.out.println("PASSOU: "+count+" verificações do orçamento automático.");
    }
}
