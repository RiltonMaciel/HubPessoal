package com.meumercado.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.text.InputType;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Locale;
import java.util.Map;
import java.util.LinkedHashMap;

public class MainActivity extends Activity {
    private static final int BG=0xFF091314, PANEL=0xFF182628, PANEL2=0xFF243438;
    private static final int GREEN=0xFF27E783, WHITE=0xFFF5FBF8, MUTED=0xFFADBBB8;
    private static final int RED=0xFFFF626C, YELLOW=0xFFF6C15F;
    private static final int CAMERA_REQ=100, GALLERY_REQ=101, LOCATION_REQ=102;
    private final Locale pt = new Locale("pt","BR");
    private SharedPreferences pref;
    private Store db;
    private JSONArray draft=new JSONArray();
    private long createdAt, budget=30000;
    private final LinkedHashMap<String,Long> balances=new LinkedHashMap<>();
    private LinearLayout content, listHolder, bar;
    private TextView totalView, budgetView, availableView, countView;
    private Dialog currentDialog;
    private ImageView imagePreview;
    private String imagePath="";
    private EditText productName, productPrice, productQty;
    private int editingIndex=-1;
    private boolean showingAlert=false;
    private String market="",address="";
    private Double latitude=null,longitude=null;

    @Override public void onCreate(Bundle state){super.onCreate(state);
        getWindow().setStatusBarColor(BG);getWindow().setNavigationBarColor(BG);
        getWindow().getDecorView().setSystemUiVisibility(0);
        pref=getSharedPreferences("meu_mercado",MODE_PRIVATE);db=new Store(this);
        balances.put("Vale-alimentação",0L);balances.put("Vale-refeição",0L);
        balances.put("Pix / Conta",0L);balances.put("Dinheiro",0L);balances.put("Cartão de crédito",0L);
        load();showHome();
        if(!pref.getBoolean("welcome",false)){
            pref.edit().putBoolean("welcome",true).apply();
            new android.os.Handler(getMainLooper()).postDelayed(()->{
                new AlertDialog.Builder(this).setTitle("Bem-vindo ao Meu Mercado")
                .setMessage("Tudo é salvo no celular, mesmo sem internet. Comece configurando o orçamento e seus saldos.")
                .setPositiveButton("Configurar",(a,b)->budgetDialog()).setNegativeButton("Depois",null).show();
            },400);
        }
    }
    private void load(){
        try{draft=new JSONArray(pref.getString("draft","[]"));}catch(Exception e){draft=new JSONArray();}
        budget=pref.getLong("budget",30000);createdAt=pref.getLong("created",System.currentTimeMillis());
        if(pref.contains("balances")){try{JSONObject o=new JSONObject(pref.getString("balances","{}"));for(String k:balances.keySet())if(o.has(k))balances.put(k,Math.max(0,o.optLong(k)));java.util.Iterator<String> keys=o.keys();while(keys.hasNext()){String k=keys.next();if(!balances.containsKey(k))balances.put(k,Math.max(0,o.optLong(k)));}}catch(Exception ignored){}}
        market=pref.getString("market","");address=pref.getString("address","");
        if(pref.contains("lat")){latitude=Double.longBitsToDouble(pref.getLong("lat",0));longitude=Double.longBitsToDouble(pref.getLong("lng",0));}
    }
    private void save(){
        JSONObject b=new JSONObject();try{for(Map.Entry<String,Long>e:balances.entrySet())b.put(e.getKey(),e.getValue());}catch(Exception ignored){}
        SharedPreferences.Editor ed=pref.edit().putString("draft",draft.toString()).putLong("budget",budget).putLong("created",createdAt)
                .putString("balances",b.toString()).putString("market",market).putString("address",address);
        if(latitude!=null&&longitude!=null)ed.putLong("lat",Double.doubleToLongBits(latitude)).putLong("lng",Double.doubleToLongBits(longitude));
        else ed.remove("lat").remove("lng");
        ed.apply();
    }
    private int dp(float v){return (int)(getResources().getDisplayMetrics().density*v+.5f);}
    private String money(long cents){return NumberFormat.getCurrencyInstance(pt).format(cents/100.0);}
    private String date(long t){return new SimpleDateFormat("dd/MM/yyyy 'às' HH:mm",pt).format(new Date(t));}
    private GradientDrawable bg(int color,int radius){GradientDrawable g=new GradientDrawable();g.setColor(color);g.setCornerRadius(dp(radius));return g;}
    private GradientDrawable outlined(int color,int radius,int stroke){GradientDrawable g=bg(color,radius);g.setStroke(dp(1),stroke);return g;}
    private LinearLayout col(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);return l;}
    private LinearLayout row(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.HORIZONTAL);l.setGravity(Gravity.CENTER_VERTICAL);return l;}
    private TextView text(String s,int size,int color,boolean bold){TextView t=new TextView(this);t.setText(s);t.setTextSize(size);t.setTextColor(color);if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);t.setGravity(Gravity.CENTER_VERTICAL);return t;}
    private TextView center(String s,int size,int color,boolean bold){TextView t=text(s,size,color,bold);t.setGravity(Gravity.CENTER);return t;}
    private LinearLayout.LayoutParams lp(int w,int h){return new LinearLayout.LayoutParams(w<0?w:dp(w),h<0?h:dp(h));}
    private void pad(View v,int l,int t,int r,int b){v.setPadding(dp(l),dp(t),dp(r),dp(b));}
    private void margin(LinearLayout parent,View v,int l,int t,int r,int b){LinearLayout.LayoutParams p=lp(-1,-2);p.setMargins(dp(l),dp(t),dp(r),dp(b));parent.addView(v,p);}
    private Button button(String name,int color,int fg,Runnable action){Button b=new Button(this);b.setAllCaps(false);b.setText(name);b.setTextColor(fg);b.setTextSize(13);b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);b.setBackground(bg(color,13));b.setOnClickListener(v->action.run());return b;}
    private EditText input(String hint,String value,int type){EditText e=new EditText(this);e.setSingleLine(true);e.setTextColor(WHITE);e.setHintTextColor(MUTED);e.setTextSize(16);e.setHint(hint);e.setText(value);e.setInputType(type);e.setSelectAllOnFocus(true);e.setBackground(bg(PANEL2,12));pad(e,14,10,14,10);return e;}
    private void label(LinearLayout p,String name){margin(p,text(name,13,MUTED,false),0,12,0,6);}
    private void field(LinearLayout p,String name,EditText e){label(p,name);p.addView(e,lp(-1,47));}
    private long price(String value){return BalanceMath.parseMoney(value);}
    private double amount(String value){try{return Double.parseDouble(value.trim().replace(",","."));}catch(Exception e){return -1;}}
    private long itemTotal(JSONObject i){return Math.round(i.optLong("price")*i.optDouble("qty",1));}
    private long total(){long v=0;for(int n=0;n<draft.length();n++)v+=itemTotal(draft.optJSONObject(n));return v;}
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_SHORT).show();}
    private void header(LinearLayout p,String heading,String sub){
        LinearLayout top=row();TextView icon=center("🛒",28,GREEN,true);top.addView(icon,lp(47,48));
        LinearLayout titles=col();titles.addView(text(heading,22,WHITE,true));titles.addView(text(sub,11,MUTED,false));top.addView(titles,new LinearLayout.LayoutParams(0,-2,1));
        Button more=button("⚙",PANEL2,WHITE,()->settingsDialog());top.addView(more,lp(48,48));margin(p,top,16,12,16,12);
    }
    private LinearLayout tile(String label,String value,int c){LinearLayout box=col();box.setBackground(bg(PANEL,13));pad(box,10,11,7,12);
        box.addView(text(label,10,MUTED,false));TextView v=text(value,15,c,true);v.setTag("value");margin(box,v,0,6,0,0);return box;}
    private void showHome(){
        LinearLayout root=col();root.setBackgroundColor(BG);setContentView(root);
        header(root,"Meu Mercado","Sua compra sob controle");
        LinearLayout metrics=row();pad(metrics,13,0,13,0);
        long spent=total();budgetView=text(money(budget),15,WHITE,true);totalView=text(money(spent),15,RED,true);availableView=text(money(budget-spent),15,budget>=spent?GREEN:RED,true);
        String[] names={"ORÇAMENTO","GASTO","RESTANTE"};TextView[] views={budgetView,totalView,availableView};
        for(int j=0;j<3;j++){LinearLayout c=col();c.setBackground(bg(PANEL,12));pad(c,8,11,7,11);c.addView(text(names[j],10,MUTED,false));margin(c,views[j],0,7,0,0);
            LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,dp(71),1);p.setMargins(dp(3),0,dp(3),0);metrics.addView(c,p);}
        root.addView(metrics,lp(-1,-2));
        LinearLayout progress=col();pad(progress,20,13,20,0);LinearLayout track=row();track.setBackground(bg(PANEL2,5));
        long pct=budget>0?Math.min(100,Math.max(0,spent*100/budget)):(spent>0?100:0);
        View fill=new View(this);fill.setBackground(bg(spent>budget?RED:GREEN,5));track.addView(fill,new LinearLayout.LayoutParams(0,dp(8),pct));track.addView(new View(this),new LinearLayout.LayoutParams(0,dp(8),100-pct));
        progress.addView(track,lp(-1,8));progress.addView(text(pct+"% do orçamento utilizado",11,MUTED,false),lp(-1,24));root.addView(progress);
        long sumBalances=BalanceMath.total(balances.values());TextView totalBalance=text("Saldo total disponível: "+money(sumBalances)+"  ·  Editar em Saldos",12,sumBalances>=spent?GREEN:YELLOW,true);pad(totalBalance,20,0,5,9);root.addView(totalBalance);
        LinearLayout listTitle=row();pad(listTitle,20,0,15,0);listTitle.addView(text("Lista de compras",18,WHITE,true),new LinearLayout.LayoutParams(0,dp(39),1));
        countView=text(draft.length()+" produtos",12,MUTED,false);listTitle.addView(countView);root.addView(listTitle);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setVerticalScrollBarEnabled(false);listHolder=col();pad(listHolder,14,0,14,8);scroll.addView(listHolder);
        root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));rebuildList();
        LinearLayout foot=col();foot.setBackground(bg(PANEL,19));pad(foot,15,11,15,12);
        LinearLayout totals=row();totals.addView(text("Total da compra",13,MUTED,false),new LinearLayout.LayoutParams(0,dp(35),1));totals.addView(text(money(spent),23,spent>budget?RED:GREEN,true));foot.addView(totals);
        LinearLayout actions=row();Button photo=button("📷 Foto",PANEL2,WHITE,()->productDialog(-1,true));Button add=button("＋ Adicionar produto",GREEN,BG,()->productDialog(-1,false));
        actions.addView(photo,new LinearLayout.LayoutParams(0,dp(52),1));LinearLayout.LayoutParams ap=new LinearLayout.LayoutParams(0,dp(52),2);ap.setMargins(dp(8),0,0,0);actions.addView(add,ap);foot.addView(actions);
        Button checkout=button("✓ Finalizar compra",PANEL2,GREEN,()->checkoutDialog());margin(foot,checkout,0,8,0,0);
        margin(root,foot,10,3,10,4);
        LinearLayout nav=row();pad(nav,10,5,10,10);
        String[] titles={"Compra","Saldos","Histórico","Análises"};String[] icons={"🛒","◈","◷","▥"};Runnable[] on={()->productDialog(-1,false),()->budgetDialog(),()->historyDialog(),()->analyticsDialog()};
        for(int i=0;i<4;i++){final int n=i;LinearLayout cell=col();cell.setGravity(Gravity.CENTER);cell.setBackground(bg(i==0?PANEL2:BG,11));cell.addView(center(icons[i],24,i==0?GREEN:MUTED,false));cell.addView(center(titles[i],10,WHITE,i==0));cell.setOnClickListener(v->on[n].run());nav.addView(cell,new LinearLayout.LayoutParams(0,dp(59),1));}
        root.addView(nav,lp(-1,69));
    }
    private void rebuildList(){if(listHolder==null)return;listHolder.removeAllViews();
        if(draft.length()==0){LinearLayout empty=col();empty.setGravity(Gravity.CENTER);pad(empty,10,60,10,20);empty.addView(center("🛒",50,GREEN,true));empty.addView(center("Sua lista está vazia",19,WHITE,true));margin(empty,center("Adicione produtos pelo botão abaixo.",13,MUTED,false),0,13,0,0);listHolder.addView(empty);return;}
        for(int i=0;i<draft.length();i++){final int index=i;JSONObject item=draft.optJSONObject(i);if(item==null)continue;
            LinearLayout line=row();line.setBackground(bg(PANEL,12));pad(line,8,8,9,8);
            ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);image.setBackground(bg(PANEL2,10));String imageName=item.optString("image");
            if(!imageName.isEmpty()){Bitmap bmp=BitmapFactory.decodeFile(new File(getFilesDir(),imageName).getAbsolutePath());if(bmp!=null)image.setImageBitmap(bmp);else image.setImageResource(android.R.drawable.ic_menu_gallery);}else image.setImageResource(android.R.drawable.ic_menu_gallery);
            line.addView(image,lp(53,58));
            LinearLayout details=col();pad(details,11,3,2,2);details.addView(text(item.optString("name"),14,WHITE,true));details.addView(text(formatQty(item.optDouble("qty",1))+" "+item.optString("unit","un")+" × "+money(item.optLong("price")),11,MUTED,false));
            LinearLayout.LayoutParams dd=new LinearLayout.LayoutParams(0,-2,1);line.addView(details,dd);
            TextView val=text(money(itemTotal(item)),13,GREEN,true);line.addView(val);line.setOnClickListener(v->productDialog(index,false));
            margin(listHolder,line,0,0,0,7);
        }
    }
    private String formatQty(double v){return v==(long)v?String.valueOf((long)v):String.format(pt,"%.3f",v);}
    private Dialog modal(String title){Dialog d=new Dialog(this);d.requestWindowFeature(Window.FEATURE_NO_TITLE);d.getWindow();
        LinearLayout shell=col();shell.setBackground(bg(BG,24));pad(shell,19,18,19,18);
        LinearLayout bar=row();TextView t=text(title,21,WHITE,true);bar.addView(t,new LinearLayout.LayoutParams(0,dp(42),1));
        Button close=button("✕",PANEL2,WHITE,()->d.dismiss());bar.addView(close,lp(46,42));shell.addView(bar);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(false);scroll.setVerticalScrollBarEnabled(false);content=col();pad(content,0,8,0,5);scroll.addView(content);shell.addView(scroll,new LinearLayout.LayoutParams(-1,-2));
        d.setContentView(shell);Window w=d.getWindow();if(w!=null){w.setBackgroundDrawableResource(android.R.color.transparent);w.setLayout(-1,-2);w.setGravity(Gravity.BOTTOM);w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);WindowManager.LayoutParams p=w.getAttributes();p.dimAmount=.72f;w.setAttributes(p);}
        d.setOnDismissListener(dialog->{if(currentDialog==d){currentDialog=null;imagePreview=null;}});d.show();if(w!=null)w.setLayout(-1,-2);currentDialog=d;return d;}
    private void productDialog(int index,boolean photo){editingIndex=index;imagePath=index<0?"":draft.optJSONObject(index).optString("image","");
        Dialog d=modal(index<0?"Adicionar produto":"Editar produto");JSONObject i=index<0?new JSONObject():draft.optJSONObject(index);
        LinearLayout photoLine=row();ImageView img=new ImageView(this);img.setBackground(bg(PANEL2,14));img.setScaleType(ImageView.ScaleType.CENTER_CROP);img.setImageResource(android.R.drawable.ic_menu_camera);
        if(!imagePath.isEmpty()){Bitmap b=BitmapFactory.decodeFile(new File(getFilesDir(),imagePath).getAbsolutePath());if(b!=null)img.setImageBitmap(b);}imagePreview=img;photoLine.addView(img,lp(115,110));
        LinearLayout pBtns=col();pad(pBtns,12,0,0,0);Button camera=button("📷 Tirar foto",PANEL2,WHITE,()->startCamera());pBtns.addView(camera,lp(-1,51));
        Button gallery=button("Galeria",PANEL2,WHITE,()->openGallery());margin(pBtns,gallery,0,8,0,0);photoLine.addView(pBtns,new LinearLayout.LayoutParams(0,-2,1));margin(content,photoLine,0,8,0,10);
        productName=input("Ex.: Arroz branco 5 kg",i.optString("name"),InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        productPrice=input("Ex.: 25,90",i.has("price")?String.format(pt,"%.2f",i.optLong("price")/100.0):"",InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);
        productQty=input("Ex.: 1",i.has("qty")?formatQty(i.optDouble("qty",1)):"1",InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);
        field(content,"Nome do produto",productName);field(content,"Preço unitário (R$)",productPrice);field(content,"Quantidade (pode ser fracionada)",productQty);
        label(content,"Unidade");LinearLayout urow=row();final String[] u={i.optString("unit","un")};String[] units={"un","kg","g","L"};
        final Button[] unitButtons=new Button[units.length];
        for(int q=0;q<units.length;q++){
            final int selected=q;
            Button b=button(units[q],u[0].equals(units[q])?GREEN:PANEL2,u[0].equals(units[q])?BG:WHITE,()->{
                u[0]=units[selected];for(int n=0;n<unitButtons.length;n++){
                    unitButtons[n].setBackground(bg(n==selected?GREEN:PANEL2,13));unitButtons[n].setTextColor(n==selected?BG:WHITE);
                }
            });unitButtons[q]=b;urow.addView(b,new LinearLayout.LayoutParams(0,dp(42),1));
        }content.addView(urow);
        Button confirm=button(index<0?"Adicionar à lista":"Salvar alterações",GREEN,BG,()->commitItem(index,u[0]));margin(content,confirm,0,18,0,0);
        if(index>=0){Button del=button("Excluir produto",PANEL2,RED,()->new AlertDialog.Builder(this).setTitle("Excluir produto?").setPositiveButton("Excluir",(a,b)->{JSONArray arr=new JSONArray();for(int k=0;k<draft.length();k++)if(k!=index)arr.put(draft.opt(k));draft=arr;save();d.dismiss();showHome();}).setNegativeButton("Cancelar",null).show());margin(content,del,0,8,0,0);}
        if(photo)startCamera();
    }
    private void commitItem(int index,String selectedUnit){
        String name=productName.getText().toString().trim();long cost=price(productPrice.getText().toString());double qty=amount(productQty.getText().toString());
        if(name.isEmpty()||cost<0||qty<=0||Double.isInfinite(qty)||Double.isNaN(qty)){toast("Informe nome, preço e quantidade válidos.");return;}
        JSONObject o=new JSONObject();try{o.put("name",name);o.put("price",cost);o.put("qty",qty);o.put("unit",selectedUnit);o.put("image",imagePath);}catch(JSONException ignored){}
        long oldTotal=total();if(index<0)draft.put(o);else{try{draft.put(index,o);}catch(JSONException ignored){}}
        save();if(currentDialog!=null)currentDialog.dismiss();showHome();
        if(oldTotal<=budget && total()>budget && !showingAlert)overspendAlert();
    }
    private void startCamera(){try{Intent intent=new Intent(MediaStore.ACTION_IMAGE_CAPTURE);startActivityForResult(intent,CAMERA_REQ);}catch(Exception e){toast("Não foi possível abrir a câmera.");}}
    private void openGallery(){try{Intent intent=new Intent(Intent.ACTION_GET_CONTENT);intent.setType("image/*");startActivityForResult(Intent.createChooser(intent,"Escolher imagem"),GALLERY_REQ);}catch(Exception e){toast("Não foi possível abrir a galeria.");}}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(result!=RESULT_OK||data==null)return;try{
        Bitmap bmp=null;if(request==CAMERA_REQ){Object resultObj=data.getExtras()==null?null:data.getExtras().get("data");if(resultObj instanceof Bitmap)bmp=(Bitmap)resultObj;}
        if(request==GALLERY_REQ){Uri uri=data.getData();if(uri!=null){try(InputStream stream=getContentResolver().openInputStream(uri)){bmp=BitmapFactory.decodeStream(stream);}}}
        if(bmp!=null){float factor=Math.min(1f,800f/Math.max(bmp.getWidth(),bmp.getHeight()));Bitmap scaled=Bitmap.createScaledBitmap(bmp,Math.max(1,Math.round(bmp.getWidth()*factor)),Math.max(1,Math.round(bmp.getHeight()*factor)),true);String id="produto_"+System.currentTimeMillis()+".jpg";
            try(FileOutputStream output=openFileOutput(id,MODE_PRIVATE)){scaled.compress(Bitmap.CompressFormat.JPEG,85,output);}imagePath=id;if(imagePreview!=null)imagePreview.setImageBitmap(scaled);toast("Foto adicionada.");}
    }catch(Exception e){toast("Não foi possível salvar a fotografia.");}}
    private void overspendAlert(){showingAlert=true;new AlertDialog.Builder(this).setTitle("⚠ Orçamento ultrapassado")
        .setMessage("Você passou "+money(total()-budget)+" do limite. Pode continuar, ajustar a lista ou finalizar informando como pagará a diferença.")
        .setPositiveButton("Continuar",(d,w)->{showingAlert=false;})
        .setNeutralButton("Ver pagamentos",(d,w)->{showingAlert=false;checkoutDialog();})
        .setNegativeButton("Revisar lista",(d,w)->{showingAlert=false;}).setOnCancelListener(d->showingAlert=false).show();}
    private void appendBalanceEditor(LinearLayout target,String name,long value,LinkedHashMap<String,EditText> edits,Runnable refresh){
        label(target,name);
        LinearLayout line=row();EditText ed=input("Saldo atual (R$)",String.format(pt,"%.2f",value/100.0),InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);
        line.addView(ed,new LinearLayout.LayoutParams(0,dp(52),1));
        Button add=button("＋",PANEL2,GREEN,()->addToBalanceDialog(name,ed,refresh));
        add.setContentDescription("Adicionar dinheiro ao saldo de "+name);
        LinearLayout.LayoutParams plusParams=lp(56,52);plusParams.leftMargin=dp(9);line.addView(add,plusParams);
        margin(target,line,0,0,0,3);edits.put(name,ed);
        ed.addTextChangedListener(new TextWatcher(){
            @Override public void beforeTextChanged(CharSequence s,int start,int count,int after){}
            @Override public void onTextChanged(CharSequence s,int start,int before,int count){refresh.run();}
            @Override public void afterTextChanged(Editable s){}
        });
        refresh.run();
    }
    private void addToBalanceDialog(String name,EditText current,Runnable refresh){
        EditText increment=input("Quanto deseja acrescentar?","",InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);
        LinearLayout box=col();pad(box,22,10,22,4);
        box.addView(text("Saldo atual: "+money(Math.max(0,price(current.getText().toString()))),14,WHITE,true));
        field(box,"Adicionar valor em reais",increment);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Adicionar saldo · "+name).setView(box)
            .setPositiveButton("Adicionar",null).setNegativeButton("Cancelar",null).create();
        dialog.show();
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            long extra=price(increment.getText().toString());
            long before=price(current.getText().toString());
            if(extra<=0){increment.setError("Informe um valor maior que zero");return;}
            if(before<0){current.setError("Corrija o saldo atual");dialog.dismiss();return;}
            try{
                long after=BalanceMath.add(before,extra);
                current.setText(String.format(pt,"%.2f",after/100.0));refresh.run();dialog.dismiss();
                toast("Saldo acrescido. Toque em Salvar para confirmar.");
            }catch(ArithmeticException ex){increment.setError("Valor excede o limite permitido");}
        });
    }
    private void addPaymentSourceDialog(LinearLayout holder,LinkedHashMap<String,EditText> edits,Runnable refresh){
        EditText name=input("Ex.: Cartão débito, VR extra","",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        LinearLayout box=col();pad(box,22,10,22,4);field(box,"Nome da nova forma de pagamento",name);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Nova forma de pagamento").setView(box)
            .setPositiveButton("Adicionar",null).setNegativeButton("Cancelar",null).create();dialog.show();
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            String key=name.getText().toString().trim();
            if(key.isEmpty()||key.length()>48){name.setError("Informe um nome de até 48 caracteres");return;}
            for(String existing:edits.keySet())if(existing.equalsIgnoreCase(key)){name.setError("Essa forma de pagamento já existe");return;}
            appendBalanceEditor(holder,key,0,edits,refresh);dialog.dismiss();
            toast("Agora informe o saldo e salve as alterações.");
        });
    }
    private void budgetDialog(){
        Dialog d=modal("Orçamento e saldos");
        label(content,"Limite desta compra");
        EditText b=input("Valor em reais",String.format(pt,"%.2f",budget/100.0),
            InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);
        content.addView(b,lp(-1,52));
        margin(content,text("O orçamento é o limite que você deseja gastar. Ele é independente do dinheiro disponível nas contas.",12,MUTED,false),0,7,0,15);
        TextView sumTitle=text("SALDO TOTAL DISPONÍVEL",12,MUTED,true);
        content.addView(sumTitle);
        TextView liveTotal=text(money(BalanceMath.total(balances.values())),26,GREEN,true);
        margin(content,liveTotal,0,4,0,4);
        TextView comparison=text("",12,MUTED,false);margin(content,comparison,0,0,0,13);
        LinkedHashMap<String,EditText> edits=new LinkedHashMap<>();
        Runnable refresh=()->{
            long sum=0;boolean valid=true;
            for(EditText ed:edits.values()){
                long v=price(ed.getText().toString());
                if(v<0){valid=false;continue;}
                try{sum=Math.addExact(sum,v);}catch(ArithmeticException ex){valid=false;}
            }
            if(valid){liveTotal.setText(money(sum));liveTotal.setTextColor(GREEN);}
            else{liveTotal.setText("Confira os valores");liveTotal.setTextColor(YELLOW);}
            long selected=price(b.getText().toString());
            if(selected<0){comparison.setText("Orçamento inválido");comparison.setTextColor(RED);}
            else if(valid){
                comparison.setText(sum<selected?"Faltam "+money(selected-sum)+" para cobrir o limite planejado.":"Saldo cobre o orçamento planejado.");
                comparison.setTextColor(sum<selected?YELLOW:MUTED);
            }else comparison.setText("Corrija os campos de saldo para somar o total.");
        };
        b.addTextChangedListener(new TextWatcher(){
            @Override public void beforeTextChanged(CharSequence s,int start,int count,int after){}
            @Override public void onTextChanged(CharSequence s,int start,int before,int count){refresh.run();}
            @Override public void afterTextChanged(Editable s){}
        });
        LinearLayout holder=col();content.addView(holder);
        for(Map.Entry<String,Long> e:balances.entrySet())appendBalanceEditor(holder,e.getKey(),e.getValue(),edits,refresh);
        Button custom=button("＋ Nova forma de pagamento",PANEL2,GREEN,()->addPaymentSourceDialog(holder,edits,refresh));
        margin(content,custom,0,12,0,0);
        margin(content,text("Edite um campo para definir o saldo ou toque em ＋ para acrescentar dinheiro ao valor atual. Confira a soma acima.",12,MUTED,false),0,11,0,5);
        Button saveButton=button("Salvar orçamento e saldos",GREEN,BG,()->{
            long value=price(b.getText().toString());if(value<0){b.setError("Orçamento inválido");return;}
            LinkedHashMap<String,Long> next=new LinkedHashMap<>();
            for(Map.Entry<String,EditText> e:edits.entrySet()){
                long v=price(e.getValue().getText().toString());
                if(v<0){e.getValue().setError("Saldo inválido");return;}
                next.put(e.getKey(),v);
            }
            try{BalanceMath.total(next.values());}catch(ArithmeticException ex){toast("Saldo total excede o limite permitido");return;}
            budget=value;balances.clear();balances.putAll(next);save();d.dismiss();showHome();
            toast("Saldos atualizados: "+money(BalanceMath.total(balances.values())));
        });margin(content,saveButton,0,15,0,5);
        refresh.run();
    }
    private void checkoutDialog(){if(draft.length()==0){toast("Adicione algum produto antes de finalizar.");return;}
        Dialog d=modal("Finalizar compra");long total=total();margin(content,text("Total "+money(total),26,GREEN,true),0,9,0,8);
        if(total>budget){TextView t=text("Você passou "+money(total-budget)+" do orçamento. Informe como pagará a compra, incluindo o excedente.",13,RED,true);margin(content,t,0,0,0,12);}
        LinkedHashMap<String,EditText> edits=new LinkedHashMap<>();long remaining=total;
        for(Map.Entry<String,Long>e:balances.entrySet()){
            long portion=Math.min(Math.max(0,e.getValue()),remaining);remaining-=portion;
            label(content,e.getKey()+" · Disponível: "+money(e.getValue()));EditText input=input("Valor pago (R$)",String.format(pt,"%.2f",portion/100.0),InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);content.addView(input,lp(-1,49));edits.put(e.getKey(),input);
        }
        if(remaining>0){margin(content,text("Faltam "+money(remaining)+" para pagar. Ajuste os valores ou os saldos.",12,YELLOW,false),0,9,0,0);}
        label(content,"Supermercado (opcional)");EditText mk=input("Nome do estabelecimento",market,InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);content.addView(mk,lp(-1,49));
        label(content,"Endereço ou referência (opcional)");EditText adr=input("Rua, número, bairro e cidade",address,InputType.TYPE_CLASS_TEXT);content.addView(adr,lp(-1,49));
        Button loc=button(latitude!=null?"✓ GPS registrado · Editar local":"◎ Capturar localização GPS (opcional)",PANEL2,WHITE,()->requestLocation());margin(content,loc,0,12,0,2);
        margin(content,text("Criada em "+date(createdAt)+" · Finalização registrada automaticamente.",12,MUTED,false),0,12,0,0);
        Button finish=button("Salvar compra no histórico",GREEN,BG,()->{
            JSONObject pay=new JSONObject();long paid=0;LinkedHashMap<String,Long> vals=new LinkedHashMap<>();for(Map.Entry<String,EditText>e:edits.entrySet()){
                long c=price(e.getValue().getText().toString());if(c<0){toast("Pagamento inválido");return;}vals.put(e.getKey(),c);paid+=c;}
            if(paid!=total){toast("Os pagamentos somam "+money(paid)+", mas a compra totalizou "+money(total)+".");return;}
            for(Map.Entry<String,Long>e:vals.entrySet()){long bal=balances.get(e.getKey());if(e.getValue()>bal){
                new AlertDialog.Builder(this).setTitle("Saldo insuficiente: "+e.getKey()).setMessage("Saldo registrado: "+money(bal)+". Deseja ajustar seus saldos antes de finalizar?")
                .setPositiveButton("Ajustar",(x,y)->{d.dismiss();budgetDialog();}).setNegativeButton("Voltar",null).show();return;}}
            try{for(Map.Entry<String,Long>e:vals.entrySet())pay.put(e.getKey(),e.getValue());}catch(Exception ex){toast("Erro ao registrar pagamentos");return;}
            market=mk.getText().toString().trim();address=adr.getText().toString().trim();
            try{db.insert(createdAt,System.currentTimeMillis(),market,address,latitude,longitude,total,budget,pay.toString(),draft.toString());}
            catch(Exception ex){toast("Falha ao salvar a compra. Saldos preservados.");return;}
            for(Map.Entry<String,Long>e:vals.entrySet())balances.put(e.getKey(),BalanceMath.debit(balances.get(e.getKey()),e.getValue()));
            draft=new JSONArray();createdAt=System.currentTimeMillis();latitude=null;longitude=null;save();d.dismiss();showHome();toast("Compra registrada com sucesso!");
        });margin(content,finish,0,20,0,0);
    }
    private void requestLocation(){if(Build.VERSION.SDK_INT>=23 && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){
        requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},LOCATION_REQ);return;}captureLocation();}
    @Override public void onRequestPermissionsResult(int req,String[] perms,int[] results){super.onRequestPermissionsResult(req,perms,results);if(req==LOCATION_REQ){if(results.length>0&&(results[0]==PackageManager.PERMISSION_GRANTED||(results.length>1&&results[1]==PackageManager.PERMISSION_GRANTED)))captureLocation();else toast("Sem permissão. Informe o local manualmente.");}}
    private void captureLocation(){try{LocationManager lm=(LocationManager)getSystemService(Context.LOCATION_SERVICE);Location best=null;
        for(String provider:new String[]{LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER}){
            if(lm.isProviderEnabled(provider)){Location l=lm.getLastKnownLocation(provider);if(l!=null&&(best==null||l.getTime()>best.getTime()))best=l;}}
        if(best!=null){latitude=best.getLatitude();longitude=best.getLongitude();save();toast("Coordenadas GPS registradas. Confira o estabelecimento.");}else toast("GPS sem posição recente. Você pode preencher o local manualmente.");
    }catch(Exception e){toast("Localização indisponível. Use o cadastro manual.");}}
    private void historyDialog(){Dialog d=modal("Histórico de compras");JSONArray entries=db.all();
        if(entries.length()==0){margin(content,text("Nenhuma compra finalizada até agora.",14,MUTED,false),0,25,0,20);return;}
        for(int i=0;i<entries.length();i++){JSONObject h=entries.optJSONObject(i);if(h==null)continue;
            LinearLayout card=col();card.setBackground(bg(PANEL,13));pad(card,13,12,13,12);
            card.addView(text(h.optString("market").isEmpty()?"Mercado não informado":h.optString("market"),16,WHITE,true));
            card.addView(text(date(h.optLong("closed")),12,MUTED,false));card.addView(text(money(h.optLong("total")),17,GREEN,true));card.setOnClickListener(v->detailDialog(h));
            margin(content,card,0,7,0,5);
        }
    }
    private void detailDialog(JSONObject entry){Dialog d=modal("Detalhes da compra");
        margin(content,text(money(entry.optLong("total")),25,GREEN,true),0,12,0,4);
        label(content,"Criada em: "+date(entry.optLong("created")));label(content,"Finalizada em: "+date(entry.optLong("closed")));
        label(content,"Supermercado: "+entry.optString("market","Não informado"));
        label(content,"Endereço: "+entry.optString("address","Não informado"));
        JSONObject paid=new JSONObject();try{paid=new JSONObject(entry.optString("payments","{}"));}catch(Exception ignored){}
        for(String key:balances.keySet()){if(paid.optLong(key,0)>0)label(content,key+": "+money(paid.optLong(key)));}
        label(content,"Produtos");try{JSONArray products=new JSONArray(entry.optString("items","[]"));for(int i=0;i<products.length();i++){JSONObject ob=products.optJSONObject(i);if(ob!=null){TextView line=text(ob.optString("name")+" · "+formatQty(ob.optDouble("qty",1))+" × "+money(ob.optLong("price")),12,WHITE,false);margin(content,line,0,5,0,7);}}}catch(Exception ignored){}
        if(!entry.isNull("lat")&&!entry.isNull("lng")){Button mapBtn=button("Abrir localização no mapa",PANEL2,WHITE,()->{
            double lat=entry.optDouble("lat"),lon=entry.optDouble("lng");Uri uri=Uri.parse("geo:"+lat+","+lon+"?q="+lat+","+lon);
            try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception e){toast("Instale um aplicativo de mapas.");}});margin(content,mapBtn,0,13,0,0);}
        Button edit=button("Editar estabelecimento e endereço",PANEL2,GREEN,()->editLocationDialog(entry,d));margin(content,edit,0,12,0,0);
    }
    private void editLocationDialog(JSONObject entry,Dialog previous){Dialog d=modal("Corrigir local da compra");
        EditText name=input("Supermercado",entry.optString("market"),InputType.TYPE_CLASS_TEXT);field(content,"Nome",name);
        EditText addr=input("Endereço",entry.optString("address"),InputType.TYPE_CLASS_TEXT);field(content,"Endereço",addr);
        Button saveBtn=button("Salvar localização manual",GREEN,BG,()->{db.updateLocation(entry.optLong("id"),name.getText().toString(),addr.getText().toString());d.dismiss();previous.dismiss();historyDialog();});margin(content,saveBtn,0,18,0,0);
    }
    private void analyticsDialog(){Dialog d=modal("Análises e estatísticas");JSONArray entries=db.all();long totalSpent=0;int buys=entries.length();LinkedHashMap<String,Long> byMarket=new LinkedHashMap<>();LinkedHashMap<String,long[]> byProduct=new LinkedHashMap<>();
        for(int i=0;i<entries.length();i++){JSONObject p=entries.optJSONObject(i);if(p==null)continue;long sum=p.optLong("total");totalSpent+=sum;String store=p.optString("market","Não informado");if(store.isEmpty())store="Não informado";
            byMarket.put(store,byMarket.containsKey(store)?byMarket.get(store)+sum:sum);
            try{JSONArray items=new JSONArray(p.optString("items","[]"));for(int j=0;j<items.length();j++){JSONObject it=items.optJSONObject(j);if(it==null)continue;String n=it.optString("name").trim().toLowerCase(pt);long[] old=byProduct.get(n);if(old==null){old=new long[]{0,0,0};byProduct.put(n,old);}old[0]+=itemTotal(it);old[1]++;old[2]=it.optLong("price");}}catch(Exception ignored){}
        }
        LinearLayout card=col();card.setBackground(bg(PANEL,15));pad(card,15,18,15,18);card.addView(text("Total registrado",13,MUTED,false));card.addView(text(money(totalSpent),27,GREEN,true));card.addView(text(buys+" compras · Média "+money(buys==0?0:totalSpent/buys),12,MUTED,false));margin(content,card,0,12,0,12);
        label(content,"Gastos por estabelecimento");for(Map.Entry<String,Long>e:byMarket.entrySet()){LinearLayout ln=row();ln.addView(text(e.getKey(),13,WHITE,false),new LinearLayout.LayoutParams(0,dp(34),1));ln.addView(text(money(e.getValue()),13,GREEN,true));content.addView(ln);}
        label(content,"Produtos mais comprados (por frequência)");
        ArrayList<Map.Entry<String,long[]>> sorted=new ArrayList<>(byProduct.entrySet());sorted.sort((a,b)->Long.compare(b.getValue()[1],a.getValue()[1]));
        for(int i=0;i<Math.min(10,sorted.size());i++){Map.Entry<String,long[]> e=sorted.get(i);LinearLayout ln=row();ln.addView(text(e.getKey(),13,WHITE,false),new LinearLayout.LayoutParams(0,dp(39),1));ln.addView(text(e.getValue()[1]+"x",13,GREEN,true));content.addView(ln);}
        label(content,"Histórico e variação de preços");for(int i=0;i<Math.min(8,sorted.size());i++){Map.Entry<String,long[]>e=sorted.get(i);if(e.getValue()[1]<2)continue;long last=e.getValue()[2];margin(content,text(e.getKey()+" · Último preço: "+money(last),12,MUTED,false),0,4,0,4);}
        if(buys==0)margin(content,text("Finalize compras para gerar comparativos de preços e mercados.",13,MUTED,false),0,10,0,10);
    }
    private void settingsDialog(){Dialog d=modal("Configurações");margin(content,text("Meu Mercado · versão 1.0 alpha",16,WHITE,true),0,10,0,6);
        margin(content,text("Seu histórico, fotos e saldos ficam salvos neste aparelho. O app funciona sem conexão de internet.",13,MUTED,false),0,8,0,11);
        Button budgetBtn=button("Configurar saldos",PANEL2,WHITE,()->{d.dismiss();budgetDialog();});margin(content,budgetBtn,0,7,0,7);
        Button reset=button("Iniciar nova lista",PANEL2,WHITE,()->new AlertDialog.Builder(this).setTitle("Iniciar nova lista?")
            .setMessage("Os produtos da compra atual serão apagados. Compras já finalizadas permanecerão no histórico.")
            .setPositiveButton("Nova lista",(a,b)->{draft=new JSONArray();createdAt=System.currentTimeMillis();save();d.dismiss();showHome();})
            .setNegativeButton("Cancelar",null).show());margin(content,reset,0,0,0,7);
        margin(content,text("Foto: câmera ou galeria. GPS: opcional. Mapa: abre no aplicativo de mapas instalado.",12,MUTED,false),0,10,0,0);
    }
}
