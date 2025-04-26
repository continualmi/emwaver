package com.emwaver.emwaverandroidapp.ir;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Provides functionality to encode IR signals based on protocol definitions.
 * Corresponds to the logic in EncodeIR.cpp.
 */
public class IrEncoder {

    private static final Map<String, String> protocolDefinitions;

    // Static block to initialize the protocol definitions map
    static {
        Map<String, String> definitions = new HashMap<>();

        // Add all protocol definitions from EncodeIR.cpp protdefs array
        definitions.put("DAC4",
                "Frequency=38000\n"
                + "Zero=500,-1000\n"
                + "One=500,-500\n"
                + "define X=(D+F)^1\n"
                + "define Y=(1+D+F)^1\n"
                + "First Bit=MSB\n"
                + "Form=7000,-2800,0:1,D:8,F:8,X:8,500,-60m;7000,-2800,1:1,D:8,F:8,Y:8,500,-60m\n"
        );
        definitions.put("Dell",
                "Define C=32796\n"
                + "Frequency=36000\n"
                + "Time Base=444\n"
                + "Message Time=107m\n"
                + "Zero=-1,1\n"
                + "One=1,-1\n"
                + "Prefix=6,-2,1,-1\n"
                + "First Bit=MSB\n"
                + "Form=;*,M:3,-2,2,C:16,T:1,D:7,F:8\n"
        );
        definitions.put("Denon-K",
                "Frequency=37000\n"
                + "Time Base=432\n"
                + "Zero=1,-1\n"
                + "One=1,-3\n"
                + "Prefix=8,-4\n"
                + "Default S=0\n"
                + "Define C=(D*16)^S^(F*16)^(F:8:4)\n"
                + "Suffix=1,-173\n"
                + "Form=;*,84:8,50:8,0:4,D:4,S:4,F:12,C:8,_\n"
        );
        definitions.put("Dgtec",
                "Frequency=38000\n"
                + "Time Base=560\n"
                + "Zero=1,-1\n"
                + "One=1,-3\n"
                + "Form=;16,-8,D:8,F:8,~F:8,1,^108m\n"
        );
        definitions.put("DishPlayer_Network",
                "Protocol=DishPlayer_Network\n" // Note: Original C++ has this line, seems redundant here
                + "Frequency=57600\n"
                + "Time Base=410\n"
                + "Zero=1,-7\n"
                + "One=1,-4\n"
                + "Suffix=1,-15\n"
                + "Form=_;F:-6,S:5,D:5,_\n"
        );
        definitions.put("Dreambox",
                "Define A=0\n"
                + "Define B=3908\n"
                + "Define G=0\n"
                + "Define H=8\n"
                + "Define J=0\n"
                + "Frequency=38000\n"
                + "First Bit=MSB\n"
                + "0=210,-760\n"
                + "1=210,-896\n"
                + "2=210,-1032\n"
                + "3=210,-1168\n"
                + "4=210,-1304\n"
                + "5=210,-1440\n"
                + "6=210,-1576\n"
                + "7=210,-1712\n"
                + "8=210,-1848\n"
                + "9=210,-1984\n"
                + "10=210,-2120\n"
                + "11=210,-2256\n"
                + "12=210,-2392\n"
                + "13=210,-2528\n"
                + "14=210,-2664\n"
                + "15=210,-2800\n"
                + "Define C=0-A-S-B-(B:4:4)-(B:4:8)-D-(D:4:4)\n"
                + "Define X=0-A-G-J-F-(F:4:4)-(F:4:8)-(F:4:12)\n"
                + "Define Y=X+G-H\n"
                + "Form=A:4,C:4,S:4,B:12,D:8,210,-13800,A:4,X:4,G:4,J:4,F:16,210,-80400;A:4,C:4,S:4,B:12,D:8,210,-13800,A:4,Y:4,H:4,J:4,F:16,210,-80400\n"
        );
        definitions.put("Furby",
                "Protocol=Furby\n"
                + "Frequency=40000\n"
                + "Time Base=125\n"
                + "Zero=1,-1,1,-5\n"
                + "One=1,-1,1,-13\n"
                + "Suffix=1,-1,1,-890\n"
                + "Form=;D:5,F:8,_\n"
        );
        definitions.put("GI4dtv",
                "Protocol=G.I.4dtv\n"
                + "Frequency=37700\n"
                + "Time Base=992\n"
                + "Zero=1,-1\n"
                + "One=1,-3\n"
                + "Prefix=5,-2\n"
                + "SUFFIX=1,-60\n"
                + "Define B=D*64+F\n"
                + "Define C=B^B*2^B*4^B*16^B*64^B*128^B*1024\n"
                + "Form=;*,B:8,C:1:10,C:3:7,_\n"
        );
        definitions.put("GI_cable",
                "Protocol=G.I.cable\n"
                + "Frequency=38400\n"
                + "Time Base=245\n"
                + "Zero=2,-9\n"
                + "One=2,-18\n"
                + "Define C=-(D+(F:4)+(F:4:4))\n"
                + "Form=36,-18,F:8,D:4,C:4,2,-120;36,-9,2,-356\n"
        );
        definitions.put("Jerrold",
                "Protocol=Jerrold\n"
                + "Frequency=0\n"
                + "Zero=44,-7500\n"
                + "One=44,-11000\n"
                + "Suffix=44,-22500\n"
                + "Form=;F:5,_\n"
        );
        definitions.put("Kaseikyo",
                "define N=90\n"
                + "define E=1\n"
                + "Frequency=37000\n"
                + "Time Base=432\n"
                + "Zero=1,-1\n"
                + "One=1,-3\n"
                + "Prefix=8,-4\n"
                + "Default S=0\n"
                + "Define X=M^N^(M:4:4)^(N:4:4)\n"
                + "Define C=D^S^F^E^(S:4:4)^(F:4:4)\n"
                + "Suffix=1,-173\n"
                + "Form=;*,M:8,N:8,X:4,D:4,S:8,F:8,E:4,C:4,_\n"
        );
        definitions.put("Kramer",
                "Frequency=38462\n"
                + "Zero=-1m,1m\n"
                + "One=-1m,2m\n"
                + "Form=4m,D:8,-2m,4500u,F:8,-33m\n"
        );
        definitions.put("Mitsubishi",
                "Protocol= Mitsubishi\n"
                + "Frequency=32600\n"
                + "Time Base=300\n"
                + "Zero=1,-3\n"
                + "One=1,-7\n"
                + "Suffix=1,-80\n"
                + "Form=;D:8,F:8,_\n"
        );
        definitions.put("NECx1",
                "Protocol=NECx1\n"
                + "Frequency=38000\n"
                + "Time Base=564\n"
                + "One=1,-3\n"
                + "Zero=1,-1\n"
                + "Prefix=8,-8\n"
                + "Suffix=1,-78\n"
                + "Default S=D\n"
                + "R-Suffix=~D:1,1,-170\n" // Note: C++ had R-Suffix=~D:1,1,-170 (maybe typo? should be R-Prefix?)
                + "Form=*,D:8,S:8,F:8,~F:8,_;*,_\n"
        );
        definitions.put("NECx2",
                "Protocol=NECx2\n"
                + "Frequency=38000\n"
                + "Time Base=564\n"
                + "One=1,-3\n"
                + "Zero=1,-1\n"
                + "Prefix=8,-8\n"
                + "Suffix=1,-78\n"
                + "Default S=D\n"
                + "Form=;*,D:8,S:8,F:8,~F:8,_\n"
        );
        definitions.put("Nokia32",
                "Define X=38\n"
                + "Default S=0\n"
                + "Protocol=Nokia32\n"
                + "Frequency=36000\n"
                + "First Bit=MSB\n"
                + "Zero=164,-276\n"
                + "One=164,-445\n"
                + "TWO=164,-614\n"
                + "THREE=164,-783\n"
                + "Form=;412,-276,D:8,S:8,X:8,F:8,164,^100m\n"
        );
        definitions.put("Nokia32single",
                "Define X=38\n"
                + "Frequency=36000\n"
                + "First Bit=MSB\n"
                + "Zero=164,-276\n"
                + "One=164,-445\n"
                + "TWO=164,-614\n"
                + "THREE=164,-783\n"
                + "Form=412,-276,D:8,S:8,X:8,F:8,164,^100m,412,-276,D:8,S:8,(X+128):8,F:8,164,-10m\n"
        );
        definitions.put("Polycom",
                "Protocol=Polycom\n"
                + "Frequency=38740\n"
                + "Zero=880,-1200\n"
                + "One=580,-880\n"
                + "Prefix=2600,-2600\n"
                + "Suffix=580,-60000\n"
                + "Form=*,D:-8,F:-6,0:2,_,*,D:-8,3:-8,_\n"
        );
        definitions.put("Proton",
                "Protocol=Proton\n"
                + "Frequency=38000\n"
                + "Time Base=500\n"
                + "Zero=1,-1\n"
                + "One=1,-3\n"
                + "Prefix=16,-8\n"
                + "Suffix=1,-45\n"
                + "Form=;*,D:8,1,-8,F:8,_\n"
        );
        definitions.put("Samsung20",
                "Protocol=Samsung20\n"
                + "Frequency=38400\n"
                + "Time Base=564\n"
                + "One=1,-3\n"
                + "Zero=1,-1\n"
                + "Default S=0\n"
                + "Form=;8,-8,D:6,S:6,F:8,1,-44\n"
        );
        definitions.put("Samsung36",
                 "define E=1\n"
                 + "Frequency=38000\n"
                 + "One=498,-1498\n"
                 + "Zero=498,-498\n"
                 + "Form=;4488,-4492,D:8,S:8,498,-4498,E:4,F:8,-68,~F:8,498,-59154\n"
                 // C++ used d:8, s:8, e:4, f:8. Using uppercase D,S,E,F for consistency.
                 // Need to confirm if IRP parser handles lowercase vars; assuming uppercase for now.
        );
        definitions.put("TViX",
                "Protocol=NEC\n" // Alias for NECx1/2? Used NECx2 below.
                + "Frequency=38000\n"
                + "Time Base=564\n"
                + "One=1,-3\n"
                + "Zero=1,-1\n"
                + "Prefix=16,-8\n"
                + "Suffix=1,-78\n"
                + "R-Prefix=16,-4\n"
                + "R-Suffix=1,-174\n"
                + "Default S=~D\n"
                + "Form=*,D:8,F:8,0:8,0:8,_;*,_\n" // Note: Differs slightly from standard NECx1/2, uses F:8,0:8,0:8
        );
        definitions.put("Teac-K",
                "define N=83\n"
                + "Frequency=37900\n"
                + "Time Base=432\n"
                + "Zero=1,-1\n"
                + "One=1,-3\n"
                + "Default S=0\n"
                + "Define X=M^N^(M:4:4)^(N:4:4)\n"
                // C++ defines T:8 in Form but T is not defined. Assume typo, maybe F? Or needs T passed?
                // For now, keeping T:8 as in C++. Generation might fail if T isn't set.
                + "Form=8,-4,M:8,N:8,X:4,D:4,S:8,F:8,T:8,1,-100;8,-8,1,-100\n"
        );
        definitions.put("Thomson",
                "Protocol=Thomson\n"
                + "Frequency=33000\n"
                + "Time Base=500\n"
                + "Zero=1,-4\n"
                + "One=1,-9\n"
                + "Suffix=1\n"
                + "Message Time=80m\n"
                 // C++ defines T:1 in Form. Assume it's a toggle bit, often related to F:1:6 in RC5/6.
                 // Needs T value (usually 0 or 1) to be set. Assuming T=0 or 1? Let's assume T might need setting.
                 + "Form=;D:4,T:1,D:1:5,F:6,1\n"
        );
        definitions.put("Tivo-Nec1",
                "define U=0\n"
                + "Protocol=TivoNec\n"
                + "Frequency=38000\n"
                + "Time Base=564\n"
                + "One=1,-3\n"
                + "Zero=1,-1\n"
                + "Prefix=16,-8\n"
                + "Suffix=1,-78\n"
                + "R-Prefix=16,-4\n"
                + "R-Suffix=1,-174\n"
                + "Default S=~D\n"
                + "Form=*,D:8,S:8,F:8,U:4,~F:4:4,_;*,_\n"
        );
        definitions.put("XMP",
                 "Define A=S:4:4\n"
                 + "Define B=3908\n"
                 + "Define G=0\n"
                 + "Define H=8\n"
                 + "Define J=S\n"
                 + "Frequency=38000\n"
                 + "First Bit=MSB\n"
                 + "0=210,-760\n"
                 + "1=210,-896\n"
                 + "2=210,-1032\n"
                 + "3=210,-1168\n"
                 + "4=210,-1304\n"
                 + "5=210,-1440\n"
                 + "6=210,-1576\n"
                 + "7=210,-1712\n"
                 + "8=210,-1848\n"
                 + "9=210,-1984\n"
                 + "10=210,-2120\n"
                 + "11=210,-2256\n"
                 + "12=210,-2392\n"
                 + "13=210,-2528\n"
                 + "14=210,-2664\n"
                 + "15=210,-2800\n"
                 + "Define C=0-A-S-B-(B:4:4)-(B:4:8)-D-(D:4:4)\n"
                 + "Define X=0-A-G-J-F-(F:4:4)-(F:4:8)-(F:4:12)\n"
                 + "Define Y=X+G-H\n"
                 // C++ uses F:8,F:8:8 - likely meant F:16 split. Correcting to F:16?
                 // Keeping as is for now to match C++.
                 + "Form=A:4,C:4,S:4,B:12,D:8,210,-13800,A:4,X:4,G:4,J:4,F:8,F:8:8,210,-80400;A:4,C:4,S:4,B:12,D:8,210,-13800,A:4,Y:4,H:4,J:4,F:8,F:8:8,210,-80400\n"
        );
        definitions.put("aiwa",
                "Protocol=Aiwa\n"
                + "Frequency=38000\n"
                + "Time Base=550\n"
                + "One=1,-3\n"
                + "Zero=1,-1\n"
                + "Prefix=16,-8\n"
                + "Suffix=1,-42\n"
                + "R-Prefix=16,-8\n"
                + "R-Suffix=1,-165\n"
                + "Form=*,D:8,S:5,~D:8,~S:5,F:8,~F:8,_;*,_\n"
        );
        definitions.put("async",
                "Protocol=Async\n"
                + "Frequency=43600\n"
                + "Time Base=833\n"
                + "Zero=1\n"
                + "One=-1\n"
                + "Prefix=1,-9,1\n"
                + "Suffix=-1,1,-9\n"
                + "First Bit=LSB\n"
                + "Form=*,1:8,1:2,D:8,1:2,F:8,1:2,F:8,1:2,1:8,_\n"
        );
        definitions.put("blaupunkt",
                "Protocol=Blaupunkt\n"
                + "Frequency=30500\n"
                + "Time Base=500\n"
                + "Zero=-1,1\n"
                + "One=1,-1\n"
                + "Prefix=1,-5\n"
                + "Suffix=-27\n"
                // C++ form uses F:7,D:2. Requires F and D values.
                + "Form=*,1023:10,_;*,1:1,F:7,D:2,_\n"
        );
        definitions.put("denon",
                "Protocol=Denon\n"
                + "Frequency=37917\n"
                + "Time Base=264\n"
                + "Zero=1,-3\n"
                + "One=1,-7\n"
                + "Suffix=1,-165\n"
                + "Form=;D:5,F:8,0:2,_,D:5,~F:8,3:2,_\n"
        );
        definitions.put("emerson",
                "Protocol=EMERSON\n"
                + "Frequency=36700\n"
                + "Time Base=872\n"
                + "Zero=1,-1\n"
                + "One=1,-3\n"
                + "Prefix=4,-4\n"
                + "Suffix=1,-39\n"
                + "Form=;*,D:6,F:6,~D:6,~F:6,_\n"
        );
        definitions.put("f12",
                "Protocol=F12\n"
                + "Frequency=38000\n"
                + "Time Base=425\n"
                + "Zero=1,-3\n"
                + "One=3,-1\n"
                // C++ form uses D:3,S:1,F:8. Requires D,S,F.
                + "Form=D:3,S:1,F:8,-80,D:3,S:1,F:8,-80\n"
        );
        definitions.put("fujitsu",
                "Define E=0\n"
                + "Define X=0\n"
                + "Protocol= Fujitsu\n"
                + "Frequency=38000\n"
                + "Time Base=400\n"
                + "Zero=1,-1\n"
                + "One=1,-3\n"
                + "Prefix=8,-4\n"
                + "Suffix=1,-110\n"
                + "Form=;*,20:8,99:8,X:4,E:4,D:8,S:8,F:8,_\n"
        );
        definitions.put("iPod",
                "Protocol=NEC\n" // Alias for NECx2 likely
                + "Frequency=38000\n"
                + "Time Base=564\n"
                + "One=1,-3\n"
                + "Zero=1,-1\n"
                + "Prefix=16,-8\n"
                + "Suffix=1,-78\n"
                + "R-Prefix=16,-4\n"
                + "R-Suffix=1,-174\n"
                + "Default S=~D\n"
                + "Form=*,D:8,S:8,F:8,63:8,_;*,_\n"
        );
        definitions.put("imonpc",
                "Frequency=39700\n"
                + "First Bit=MSB\n"
                + "Define A=840\n"
                + "Define B=300\n"
                + "Message Time=200m\n"
                + "0=(3*A-B),-(A+B)\n"
                + "1=(2*A-B),-(2*A+B)\n"
                + "2=(A-B),-(A+B),(A-B),-(A+B)\n"
                + "3=(A-B),-(3*A+B)\n"
                // C++ uses F:8,~F:8. Requires F.
                + "Form=;F:8,~F:8\n"
        );
        definitions.put("jvc",
                "Protocol=JVC\n"
                + "Frequency=37900\n"
                + "Time Base=527\n"
                + "Zero=1,-1\n"
                + "One=1,-3\n"
                + "Prefix=16,-8\n"
                + "Form=*;D:8,F:8,1,^88\n"
        );
        definitions.put("jvc_two_frames",
                "Frequency=37900\n"
                + "Time Base=527\n"
                + "Zero=1,-1\n"
                + "One=1,-3\n"
                + "Prefix=16,-8\n"
                + "Form=*,D:8,F:8,1,^88;D:8,F:8,1,^88\n"
        );
        definitions.put("lumagen",
                "Frequency=38000\n"
                + "Time Base=416\n"
                + "First Bit=MSB\n"
                + "Zero=1,-6\n"
                + "One=1,-12\n"
                + "define X=F^(F:4:4)\n"
                + "define C=X^(X:1:1)^(X:1:2)^(X:1:3)\n"
                // C++ uses D:4,~C:1,F:7. Requires D,F. T bit missing vs RC5?
                + "Form=;D:4,~C:1,F:7,1,-26\n"
        );
        definitions.put("mce", // Microsoft Media Center Edition RC6
                "Frequency=36000\n"
                + "Time Base=444\n"
                + "Message Time=106m\n"
                + "Zero=-1,1\n"
                + "One=1,-1\n"
                + "First Bit=MSB\n"
                // C++ uses M:3,-2,2,128:8,S:8,T:1,D:7,F:8.
                // Requires M, S, T, D, F. M=Mode, S=Subdevice?, T=Toggle, D=Device, F=Function
                // Need values for these, typically T=0/1. M=0 standard RC6.
                + "Form=;6,-2,1:1,M:3,-2,2,128:8,S:8,T:1,D:7,F:8\n"
        );
        definitions.put("nec1", // Alias for NECx1
                "Protocol=NEC\n"
                + "Frequency=38000\n"
                + "Time Base=564\n"
                + "One=1,-3\n"
                + "Zero=1,-1\n"
                + "Prefix=16,-8\n"
                + "Suffix=1,-78\n"
                + "R-Prefix=16,-4\n"
                + "R-Suffix=1,-174\n"
                + "Default S=~D\n"
                + "Form=*,D:8,S:8,F:8,~F:8,_;*,_\n"
        );
        definitions.put("nec2", // Alias for NECx2
                "Protocol=NEC2\n"
                + "Frequency=38000\n"
                + "Time Base=564\n"
                + "One=1,-3\n"
                + "Zero=1,-1\n"
                + "Prefix=16,-8\n"
                + "Suffix=1,-78\n"
                + "Default S=~D\n"
                + "Form=;*,D:8,S:8,F:8,~F:8,_\n"
        );
        definitions.put("panasonic",
                "Protocol= Panasonic\n"
                + "Frequency=37000\n"
                + "Time Base=432\n"
                + "Zero=1,-1\n"
                + "One=1,-3\n"
                + "Prefix=8,-4\n"
                + "Default S=0\n"
                + "Define C=D^S^F\n"
                + "Suffix=1,-173\n"
                + "Form=;*,2:8,32:8,D:8,S:8,F:8,C:8,_\n"
        );
        definitions.put("panasonic2",
                "Define X=0\n"
                + "Frequency=37000\n"
                + "Time Base=432\n"
                + "Zero=1,-1\n"
                + "One=1,-3\n"
                + "Prefix=8,-4\n"
                + "Default S=0\n"
                + "Define C=D^S^X^F\n"
                + "Suffix=1,-173\n"
                + "Form=;*,2:8,32:8,D:8,S:8,X:8,F:8,C:8,_\n"
        );
        definitions.put("pioneer", // NEC variant
                "Protocol=Pioneer\n"
                + "Frequency=40000\n"
                + "Time Base=564\n"
                + "One=1,-3\n"
                + "Zero=1,-1\n"
                + "Prefix=16,-8\n"
                + "Suffix=1,-78\n"
                + "Default S=~D\n"
                + "Form=;*,D:8,S:8,F:8,~F:8,_\n"
        );
        definitions.put("pioneer2",
                "Define P=86\n"
                + "Protocol=Pioneer2\n"
                + "Frequency=40000\n"
                + "Time Base=564\n"
                + "One=1,-3\n"
                + "Zero=1,-1\n"
                + "Prefix=16,-8\n"
                + "Suffix=1,-78\n"
                + "Form=;*,D:8,~D:8,P:8,~P:8,_,*,S:8,~S:8,F:8,~F:8,_\n"
        );
        definitions.put("rc5",
                "Protocol=RC5\n"
                + "Frequency=36000\n"
                + "Time Base=889\n"
                + "Message Time=128\n"
                + "Zero=1,-1\n"
                + "One=-1,1\n"
                + "Prefix=1\n"
                + "First Bit=MSB\n"
                // C++ Form uses T:1. Need T value (toggle, usually 0 or 1). Assuming 0/1?
                + "Form=;*,~F:1:6,T:1,D:5,F:6\n"
        );
        definitions.put("rc5odd", // RC5 with toggle forced to 1
                "Protocol=RC5\n"
                + "Frequency=36000\n"
                + "Time Base=889\n"
                + "Message Time=128\n"
                + "Zero=1,-1\n"
                + "One=-1,1\n"
                + "Prefix=1\n"
                + "First Bit=MSB\n"
                + "Form=;*,~F:1:6,1:1,D:5,F:6\n"
        );
        definitions.put("rc5x", // Extended RC5
                "Protocol=RC5x\n"
                + "Frequency=36000\n"
                + "Time Base=889\n"
                + "Message Time=128\n"
                + "Zero=1,-1\n"
                + "One=-1,1\n"
                + "First Bit=MSB\n"
                // C++ uses S:6, T:1. Need S (subdevice/extended func) and T (toggle).
                + "Form=;1,~S:1:6,T:1,D:5,-4,S:6,F:6\n"
        );
        definitions.put("rc6-M-L", // Template for RC6-Mode-Length
                 "Protocol=RC6\n"
                 + "Frequency=36000\n"
                 + "Time Base=444\n"
                 + "Message Time=107m\n"
                 + "Zero=-1,1\n"
                 + "One=1,-1\n"
                 + "Prefix=6,-2,1,-1\n"
                 + "First Bit=MSB\n"
                 + "Default S=0\n"
                 // Uses M, L, T, D, S, F defined externally
                 + "Form=;*,M:3,(4*T-2),(2-4*T),D:8,S:(L-16),F:8\n"
        );
        definitions.put("rc6", // Standard RC6 (Mode 0, Length 16)
                "Protocol=RC6\n"
                + "Frequency=36000\n"
                + "Time Base=444\n"
                + "Message Time=107m\n"
                + "Zero=-1,1\n"
                + "One=1,-1\n"
                + "Prefix=6,-2,1,-1\n"
                + "First Bit=MSB\n"
                // Uses T, D, F. M=0 implicitly. Length 16 -> S:(16-16)=S:0 is empty.
                + "Form=;*,0:3,(4*T-2),(2-4*T),D:8,F:8\n"
        );
        definitions.put("rca",
                "Protocol=RCA\n"
                + "Frequency=58000\n"
                + "Time Base=460\n"
                + "Zero=1,-2\n"
                + "One=1,-4\n"
                + "Prefix=8,-8\n"
                + "Suffix=1,-15\n"
                + "First Bit=MSB\n"
                + "Form=;*,D:4,F:8,~D:4,~F:8,_\n"
        );
        definitions.put("recs80_45",
                "Frequency=38000\n"
                + "Zero=170,-4900\n"
                + "One=170,-7425\n"
                + "MESSAGETIME=121000\n"
                + "First Bit=MSB\n"
                // Uses T, D, F
                + "Form=;1:1,T:1,D:3,F:6,170\n"
        );
        definitions.put("recs80_68",
                "Frequency=36400\n"
                + "Zero=170,-5580\n"
                + "One=170,-8440\n"
                + "MESSAGETIME=138000\n"
                + "First Bit=MSB\n"
                // Uses T, D, F
                + "Form=;1:1,T:1,D:3,F:6,170\n"
        );
        definitions.put("russound",
                "Frequency=38400\n"
                + "Time Base=601\n"
                + "Zero=1,-1\n"
                + "One=1,-2\n"
                + "Two=2,-1\n"
                + "Three=2,-2\n"
                + "First Bit=MSB\n"
                + "Define C=7*(F:2:6)+5*(F:2:4)+3*(F:2:2)+(F:2)\n"
                // Uses D, F, C
                + "Form=10,-2,D:4,F:8,C:4,1,-50;5,-2,D:4,F:8,C:4,1,-50\n"
        );
        definitions.put("sagem",
                "Frequency=56000\n"
                + "Time Base=250\n"
                + "Zero=-1,1\n"
                + "One=1,-1\n"
                + "First Bit=MSB\n"
                // Uses D, S, F
                + "Form=1:1,D:6,S:7,0:1,F:8,-350;1:1,D:6,S:7,1:1,F:8,-350\n"
        );
        definitions.put("sharp",
                "Protocol=SHARP\n"
                + "Frequency=37917\n"
                + "Time Base=264\n"
                + "Zero=1,-3\n"
                + "One=1,-7\n"
                + "Suffix=1,-165\n"
                + "Form=;D:5,F:8,1:2,_,D:5,~F:8,2:2,_\n"
        );
        definitions.put("streamzap", // PC Remote, RC5 variant
                "Frequency=59000\n"
                + "Time Base=889\n"
                + "Zero=1,-1\n"
                + "One=-1,1\n"
                + "Message Time=114\n"
                + "First Bit=MSB\n"
                // Uses T, D, F
                + "Form=;1:1,~F:1:6,T:1,D:6,F:6\n"
        );
        definitions.put("x10ir",
                "Protocol=X10IR\n"
                + "Frequency=40000\n"
                + "Time Base=650\n"
                + "One=7,-7\n"
                + "Zero=2,-13\n"
                + "Form=;*,F:5,~F:5,_\n"
                + "Prefix=8,-8\n"
                + "suffix=23,-8\n"
        );

        // Add more protocols here...

        protocolDefinitions = Collections.unmodifiableMap(definitions);
    }

    // Regex for RC6-M-L parsing
    private static final Pattern RC6_PATTERN = Pattern.compile("RC6-(\\d+)-(\\d+)", Pattern.CASE_INSENSITIVE);

    /**
     * Encodes an IR signal based on protocol, device, subdevice, and function.
     *
     * @param protocol   The name of the IR protocol (e.g., "NECx1", "RC5", "RC6-0-16").
     * @param device     The device code (D).
     * @param subdevice  The subdevice code (S). Use -1 if the protocol doesn't use a subdevice or uses default.
     * @param function   The function code (F).
     * @return A List of Doubles representing the pulse/gap sequence in microseconds, or null if encoding fails.
     */
    public static List<Double> encodeIR(String protocol, int device, int subdevice, int function) {
        if (protocol == null || protocol.isEmpty()) {
            System.err.println("Error: Protocol name cannot be null or empty.");
            return null;
        }

        String irpDefinitionBuilder = "";
        String baseProtocolName = protocol;
        String baseDefinition = null;

        // --- Handle Protocol Lookup and Special Cases ---
        Matcher rc6Matcher = RC6_PATTERN.matcher(protocol);
        if (rc6Matcher.matches()) {
            try {
                int m = Integer.parseInt(rc6Matcher.group(1)); // Mode
                int l = Integer.parseInt(rc6Matcher.group(2)); // Length
                // Prepend Define M=... and Define L=... to the base rc6-M-L definition
                irpDefinitionBuilder += String.format("Define M=%d\nDefine L=%d\n", m, l);
                baseProtocolName = "rc6-M-L"; // Use the template key
            } catch (NumberFormatException e) {
                System.err.println("Error: Invalid numbers in RC6-M-L protocol name: " + protocol);
                return null;
            }
        } else if (protocol.equalsIgnoreCase("NEC")) {
             baseProtocolName = "nec2"; // Alias used in C++
        } else if (protocol.equalsIgnoreCase("NECX")) {
            baseProtocolName = "NECx2"; // Alias used in C++
        }
        // Potentially add more aliases here if needed (e.g., case variations)

        // Look up the base definition
        baseDefinition = protocolDefinitions.get(baseProtocolName);

        if (baseDefinition == null) {
            // Try case-insensitive lookup as a fallback
            for (Map.Entry<String, String> entry : protocolDefinitions.entrySet()) {
                if (entry.getKey().equalsIgnoreCase(baseProtocolName)) {
                    baseDefinition = entry.getValue();
                    System.out.println("Used case-insensitive match for protocol: " + protocol + " -> " + entry.getKey());
                    break;
                }
            }
        }

        if (baseDefinition == null) {
            System.err.println("Error: Unknown protocol: " + protocol + " (searched for: " + baseProtocolName + ")");
            return null;
        }

        // --- Construct Full IRP String ---
        // Add Device= and Function= lines (as done in C++ main)
        if (subdevice >= 0) {
            irpDefinitionBuilder += String.format("Device=%d.%d\nFunction=%d\n", device, subdevice, function);
        } else {
            irpDefinitionBuilder += String.format("Device=%d\nFunction=%d\n", device, function);
        }
        // Append the base definition
        irpDefinitionBuilder += baseDefinition;

        // --- Create IRP Instance and Encode ---
        IRP irp = new IRP();

        // Parse the combined definition
        if (!irp.readIrpString(irpDefinitionBuilder)) {
            System.err.println("Error: Failed to parse IRP definition for protocol: " + protocol);
             System.err.println("--- Parsed Definition ---:");
             System.err.println(irpDefinitionBuilder);
             System.err.println("------------------------");
            return null;
        }

        // Generate the sequence
        // Note: Some protocols might require T (toggle), M (mode), L (length) etc.
        // The basic generate method doesn't support passing these directly.
        // They must be handled via DEFINE within the IRP string (like RC6-M-L) or
        // potentially by modifying the IRP object's value map before calling generate
        // if a more complex API is needed later.
        List<Double> sequence = irp.generate(device, subdevice, function);

        if (sequence == null || sequence.isEmpty()) {
            System.err.println("Error: Generation failed or produced empty sequence for protocol: " + protocol);
            return null;
        }

        return sequence;
    }

     // Add helper methods if needed, e.g., for RC6 parsing

} 