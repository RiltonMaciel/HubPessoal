package com.meumercado.app;

import java.util.Collection;

/** Modelo único da tela financeira: o orçamento automático soma os saldos. */
public final class BudgetSummary {
    private BudgetSummary() {}
    public static final class Snapshot {
        public final long budget, spent, remaining, totalBalances;
        public Snapshot(long budget,long spent,long remaining,long totalBalances){
            this.budget=budget;this.spent=spent;this.remaining=remaining;this.totalBalances=totalBalances;
        }
    }
    public static Snapshot calculate(Collection<Long> balances,boolean automatic,long manualBudget,long spent){
        if(manualBudget<0||spent<0)throw new IllegalArgumentException("Valor inválido");
        long totalBalances=BalanceMath.total(balances);
        long activeBudget=automatic?totalBalances:manualBudget;
        long remaining=Math.subtractExact(activeBudget,spent);
        return new Snapshot(activeBudget,spent,remaining,totalBalances);
    }
}
