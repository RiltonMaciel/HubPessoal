package com.meumercado.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;

public class Store extends SQLiteOpenHelper {
    Store(Context ctx){super(ctx,"mercado.db",null,1);}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL, closed INTEGER NOT NULL, market TEXT, address TEXT, lat REAL, lng REAL, total INTEGER NOT NULL, budget INTEGER NOT NULL, payments TEXT NOT NULL, items TEXT NOT NULL)");
        db.execSQL("CREATE INDEX idx_purchases_closed ON purchases(closed DESC)");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int from,int to){}
    long insert(long created,long closed,String market,String address,Double lat,Double lng,long total,long budget,String payments,String items){
        ContentValues c=new ContentValues();c.put("created",created);c.put("closed",closed);c.put("market",market);c.put("address",address);
        if(lat!=null)c.put("lat",lat);else c.putNull("lat");if(lng!=null)c.put("lng",lng);else c.putNull("lng");
        c.put("total",total);c.put("budget",budget);c.put("payments",payments);c.put("items",items);
        return getWritableDatabase().insertOrThrow("purchases",null,c);
    }
    JSONArray all(){JSONArray out=new JSONArray();try(Cursor cursor=getReadableDatabase().rawQuery("SELECT * FROM purchases ORDER BY closed DESC",null)){
        while(cursor.moveToNext()){JSONObject o=new JSONObject();
            for(int i=0;i<cursor.getColumnCount();i++){
                String name=cursor.getColumnName(i);if(cursor.isNull(i))o.put(name,JSONObject.NULL);
                else if(name.equals("id")||name.equals("created")||name.equals("closed")||name.equals("total")||name.equals("budget"))o.put(name,cursor.getLong(i));
                else if(name.equals("lat")||name.equals("lng"))o.put(name,cursor.getDouble(i));
                else o.put(name,cursor.getString(i));
            }out.put(o);
        }
    }catch(Exception ignored){}return out;}
    void updateLocation(long id,String market,String address){ContentValues c=new ContentValues();c.put("market",market);c.put("address",address);
        getWritableDatabase().update("purchases",c,"id=?",new String[]{String.valueOf(id)});}
}
