package com.meumercado.app;

import java.util.LinkedHashMap;
import java.util.Map;

public final class BalanceMathTest {
    private static int assertions;
    private static void eq(long expected,long actual,String test){
        assertions++;
        if(expected!=actual)throw new AssertionError(test+" esperado="+expected+" atual="+actual);
    }
    private static void invalid(Runnable block,String test){
        assertions++;
        try{block.run();throw new AssertionError(test+": deveria rejeitar");}
        catch(IllegalArgumentException | ArithmeticException ok){}
    }
    public static void main(String[] args) {
        eq(0,BalanceMath.parseMoney("0"),"zero");
        eq(10000,BalanceMath.parseMoney("100,00"),"vírgula");
        eq(123456,BalanceMath.parseMoney("R$ 1.234,56"),"milhar");
        eq(100000,BalanceMath.parseMoney("1.000"),"milhar sem decimal");
        eq(2500,BalanceMath.parseMoney("25.00"),"ponto decimal");
        eq(1,BalanceMath.parseMoney("0,01"),"centavo");
        eq(-1,BalanceMath.parseMoney(""),"vazio inválido");
        eq(-1,BalanceMath.parseMoney("-50"),"negativo inválido");
        eq(-1,BalanceMath.parseMoney("1,234"),"centavos inválidos");
        Map<String,Long> balances=new LinkedHashMap<>();
        balances.put("VA",10000L);balances.put("VR",5000L);balances.put("Pix",2000L);
        eq(17000,BalanceMath.total(balances.values()),"total inicial");
        balances.put("VA",BalanceMath.add(balances.get("VA"),5000));
        eq(15000,balances.get("VA"),"recarga acrescenta, não substitui");
        eq(22000,BalanceMath.total(balances.values()),"total após recarga VA");
        balances.put("VR",BalanceMath.add(balances.get("VR"),2500));
        eq(24500,BalanceMath.total(balances.values()),"total após duas recargas");
        balances.put("Outro",3000L);
        eq(27500,BalanceMath.total(balances.values()),"nova forma participa do total");
        balances.put("VA",BalanceMath.debit(balances.get("VA"),7000));
        eq(8000,balances.get("VA"),"desconto no pagamento");
        eq(20500,BalanceMath.total(balances.values()),"total após pagamento");
        Map<String,Long> reloaded=new LinkedHashMap<>(balances);
        eq(20500,BalanceMath.total(reloaded.values()),"total mantém valor após recarregar o mapa");
        invalid(()->BalanceMath.add(10000,0),"recarga zero");
        invalid(()->BalanceMath.debit(3000,4000),"gasto maior que saldo");
        invalid(()->BalanceMath.add(Long.MAX_VALUE,1),"overflow");
        System.out.println("PASSOU: "+assertions+" verificações monetárias.");
    }
}
