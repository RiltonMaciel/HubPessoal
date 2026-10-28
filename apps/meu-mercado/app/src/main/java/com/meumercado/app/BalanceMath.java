package com.meumercado.app;

import java.math.BigDecimal;
import java.util.Collection;

/**
 * Regras de valores monetários. Todos os valores são armazenados em centavos.
 * Classe Java pura: testável sem Android ou internet.
 */
public final class BalanceMath {
    private BalanceMath() {}

    public static long parseMoney(String raw) {
        if (raw == null) return -1;
        String v = raw.replace("R$", "").replace('\u00a0', ' ').replace(" ", "").trim();
        if (v.isEmpty()) return -1;
        // Padrão brasileiro: 1.234,56. Aceita também 1234.56.
        if (v.contains(",")) v = v.replace(".", "").replace(',', '.');
        else if (v.matches("[0-9]{1,3}(\\.[0-9]{3})+")) v = v.replace(".", "");
        if (!v.matches("[0-9]+(\\.[0-9]{1,2})?")) return -1;
        try {
            return new BigDecimal(v).movePointRight(2).longValueExact();
        } catch (ArithmeticException | NumberFormatException e) {
            return -1;
        }
    }

    public static long add(long current, long increment) {
        if (current < 0 || increment <= 0) throw new IllegalArgumentException("Recarga inválida");
        return Math.addExact(current, increment);
    }

    public static long debit(long current, long paid) {
        if (current < 0 || paid < 0 || paid > current) throw new IllegalArgumentException("Pagamento excede o saldo");
        return current - paid;
    }

    public static long total(Collection<Long> balances) {
        long sum = 0;
        for (Long balance : balances) {
            if (balance == null || balance < 0) throw new IllegalArgumentException("Saldo negativo");
            sum = Math.addExact(sum, balance);
        }
        return sum;
    }
}
