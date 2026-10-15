/**
 * The cities a place's map position is looked up in (plan #2091.3), shipped
 * with the app so no place name leaves it (decision #2091.1).
 *
 * Built once from GeoNames (geonames.org, CC BY 4.0): cities5000.txt for
 * every United States town of five thousand people or more, and the rest of
 * the world's towns of fifty thousand or more and every capital, with
 * admin1CodesASCII.txt for region names and countryInfo.txt for countries.
 * Names are the ASCII spellings. Positions are rounded to two decimals, about
 * a kilometre, which is finer than the map draws.
 *
 * One city a line, `name|region|country|latitude|longitude`, most populous
 * first, so the first match is the likeliest. The region is the state's
 * two-letter code in the United States and the region's name elsewhere; the
 * country is its ISO 3166 two-letter code. Read by lib/you/place-position.ts
 * and nothing else: it is a few hundred kilobytes, for the server only.
 */

/** `code|code3|name`, one country a line. */
export const COUNTRIES = `
AD|AND|Andorra
AE|ARE|United Arab Emirates
AF|AFG|Afghanistan
AG|ATG|Antigua and Barbuda
AI|AIA|Anguilla
AL|ALB|Albania
AM|ARM|Armenia
AO|AGO|Angola
AQ|ATA|Antarctica
AR|ARG|Argentina
AS|ASM|American Samoa
AT|AUT|Austria
AU|AUS|Australia
AW|ABW|Aruba
AX|ALA|Aland Islands
AZ|AZE|Azerbaijan
BA|BIH|Bosnia and Herzegovina
BB|BRB|Barbados
BD|BGD|Bangladesh
BE|BEL|Belgium
BF|BFA|Burkina Faso
BG|BGR|Bulgaria
BH|BHR|Bahrain
BI|BDI|Burundi
BJ|BEN|Benin
BL|BLM|Saint Barthelemy
BM|BMU|Bermuda
BN|BRN|Brunei
BO|BOL|Bolivia
BQ|BES|Bonaire, Saint Eustatius and Saba
BR|BRA|Brazil
BS|BHS|Bahamas
BT|BTN|Bhutan
BV|BVT|Bouvet Island
BW|BWA|Botswana
BY|BLR|Belarus
BZ|BLZ|Belize
CA|CAN|Canada
CC|CCK|Cocos Islands
CD|COD|Democratic Republic of the Congo
CF|CAF|Central African Republic
CG|COG|Republic of the Congo
CH|CHE|Switzerland
CI|CIV|Ivory Coast
CK|COK|Cook Islands
CL|CHL|Chile
CM|CMR|Cameroon
CN|CHN|China
CO|COL|Colombia
CR|CRI|Costa Rica
CU|CUB|Cuba
CV|CPV|Cabo Verde
CW|CUW|Curacao
CX|CXR|Christmas Island
CY|CYP|Cyprus
CZ|CZE|Czechia
DE|DEU|Germany
DJ|DJI|Djibouti
DK|DNK|Denmark
DM|DMA|Dominica
DO|DOM|Dominican Republic
DZ|DZA|Algeria
EC|ECU|Ecuador
EE|EST|Estonia
EG|EGY|Egypt
EH|ESH|Western Sahara
ER|ERI|Eritrea
ES|ESP|Spain
ET|ETH|Ethiopia
FI|FIN|Finland
FJ|FJI|Fiji
FK|FLK|Falkland Islands
FM|FSM|Micronesia
FO|FRO|Faroe Islands
FR|FRA|France
GA|GAB|Gabon
GB|GBR|United Kingdom
GD|GRD|Grenada
GE|GEO|Georgia
GF|GUF|French Guiana
GG|GGY|Guernsey
GH|GHA|Ghana
GI|GIB|Gibraltar
GL|GRL|Greenland
GM|GMB|Gambia
GN|GIN|Guinea
GP|GLP|Guadeloupe
GQ|GNQ|Equatorial Guinea
GR|GRC|Greece
GS|SGS|South Georgia and the South Sandwich Islands
GT|GTM|Guatemala
GU|GUM|Guam
GW|GNB|Guinea-Bissau
GY|GUY|Guyana
HK|HKG|Hong Kong
HM|HMD|Heard Island and McDonald Islands
HN|HND|Honduras
HR|HRV|Croatia
HT|HTI|Haiti
HU|HUN|Hungary
ID|IDN|Indonesia
IE|IRL|Ireland
IL|ISR|Israel
IM|IMN|Isle of Man
IN|IND|India
IO|IOT|British Indian Ocean Territory
IQ|IRQ|Iraq
IR|IRN|Iran
IS|ISL|Iceland
IT|ITA|Italy
JE|JEY|Jersey
JM|JAM|Jamaica
JO|JOR|Jordan
JP|JPN|Japan
KE|KEN|Kenya
KG|KGZ|Kyrgyzstan
KH|KHM|Cambodia
KI|KIR|Kiribati
KM|COM|Comoros
KN|KNA|Saint Kitts and Nevis
KP|PRK|North Korea
KR|KOR|South Korea
XK|XKX|Kosovo
KW|KWT|Kuwait
KY|CYM|Cayman Islands
KZ|KAZ|Kazakhstan
LA|LAO|Laos
LB|LBN|Lebanon
LC|LCA|Saint Lucia
LI|LIE|Liechtenstein
LK|LKA|Sri Lanka
LR|LBR|Liberia
LS|LSO|Lesotho
LT|LTU|Lithuania
LU|LUX|Luxembourg
LV|LVA|Latvia
LY|LBY|Libya
MA|MAR|Morocco
MC|MCO|Monaco
MD|MDA|Moldova
ME|MNE|Montenegro
MF|MAF|Saint Martin
MG|MDG|Madagascar
MH|MHL|Marshall Islands
MK|MKD|North Macedonia
ML|MLI|Mali
MM|MMR|Myanmar
MN|MNG|Mongolia
MO|MAC|Macao
MP|MNP|Northern Mariana Islands
MQ|MTQ|Martinique
MR|MRT|Mauritania
MS|MSR|Montserrat
MT|MLT|Malta
MU|MUS|Mauritius
MV|MDV|Maldives
MW|MWI|Malawi
MX|MEX|Mexico
MY|MYS|Malaysia
MZ|MOZ|Mozambique
NA|NAM|Namibia
NC|NCL|New Caledonia
NE|NER|Niger
NF|NFK|Norfolk Island
NG|NGA|Nigeria
NI|NIC|Nicaragua
NL|NLD|The Netherlands
NO|NOR|Norway
NP|NPL|Nepal
NR|NRU|Nauru
NU|NIU|Niue
NZ|NZL|New Zealand
OM|OMN|Oman
PA|PAN|Panama
PE|PER|Peru
PF|PYF|French Polynesia
PG|PNG|Papua New Guinea
PH|PHL|Philippines
PK|PAK|Pakistan
PL|POL|Poland
PM|SPM|Saint Pierre and Miquelon
PN|PCN|Pitcairn
PR|PRI|Puerto Rico
PS|PSE|Palestinian Territory
PT|PRT|Portugal
PW|PLW|Palau
PY|PRY|Paraguay
QA|QAT|Qatar
RE|REU|Reunion
RO|ROU|Romania
RS|SRB|Serbia
RU|RUS|Russia
RW|RWA|Rwanda
SA|SAU|Saudi Arabia
SB|SLB|Solomon Islands
SC|SYC|Seychelles
SD|SDN|Sudan
SS|SSD|South Sudan
SE|SWE|Sweden
SG|SGP|Singapore
SH|SHN|Saint Helena
SI|SVN|Slovenia
SJ|SJM|Svalbard and Jan Mayen
SK|SVK|Slovakia
SL|SLE|Sierra Leone
SM|SMR|San Marino
SN|SEN|Senegal
SO|SOM|Somalia
SR|SUR|Suriname
ST|STP|Sao Tome and Principe
SV|SLV|El Salvador
SX|SXM|Sint Maarten
SY|SYR|Syria
SZ|SWZ|Eswatini
TC|TCA|Turks and Caicos Islands
TD|TCD|Chad
TF|ATF|French Southern Territories
TG|TGO|Togo
TH|THA|Thailand
TJ|TJK|Tajikistan
TK|TKL|Tokelau
TL|TLS|Timor Leste
TM|TKM|Turkmenistan
TN|TUN|Tunisia
TO|TON|Tonga
TR|TUR|Turkey
TT|TTO|Trinidad and Tobago
TV|TUV|Tuvalu
TW|TWN|Taiwan
TZ|TZA|Tanzania
UA|UKR|Ukraine
UG|UGA|Uganda
UM|UMI|United States Minor Outlying Islands
US|USA|United States
UY|URY|Uruguay
UZ|UZB|Uzbekistan
VA|VAT|Vatican
VC|VCT|Saint Vincent and the Grenadines
VE|VEN|Venezuela
VG|VGB|British Virgin Islands
VI|VIR|U.S. Virgin Islands
VN|VNM|Vietnam
VU|VUT|Vanuatu
WF|WLF|Wallis and Futuna
WS|WSM|Samoa
YE|YEM|Yemen
YT|MYT|Mayotte
ZA|ZAF|South Africa
ZM|ZMB|Zambia
ZW|ZWE|Zimbabwe
CS|SCG|Serbia and Montenegro
AN|ANT|Netherlands Antilles
`;

export const CITIES = `
Shanghai|Shanghai|CN|31.22|121.46
Chongqing|Chongqing|CN|29.56|106.56
Chengdu|Sichuan|CN|30.67|104.07
Beijing|Beijing|CN|39.91|116.4
Guangzhou|Guangdong|CN|23.12|113.25
Shenzhen|Guangdong|CN|22.55|114.07
Kinshasa|Kinshasa|CD|-4.33|15.31
Istanbul|Istanbul|TR|41.01|28.95
Lagos|Lagos|NG|6.45|3.39
Ho Chi Minh City|Ho Chi Minh City (HCMC)|VN|10.82|106.63
Tianjin|Tianjin|CN|39.14|117.18
Wuhan|Hubei|CN|30.58|114.27
Lahore|Punjab|PK|31.56|74.35
Xi'an|Shaanxi|CN|34.26|108.93
Mumbai|Maharashtra|IN|19.07|72.88
Sao Paulo|Sao Paulo|BR|-23.55|-46.64
Mexico City|Mexico City|MX|19.43|-99.13
Hangzhou|Zhejiang|CN|30.29|120.16
Karachi|Sindh|PK|24.86|67.01
Delhi|Delhi|IN|28.65|77.23
Moscow|Moscow|RU|55.75|37.62
Dhaka|Dhaka Division|BD|23.71|90.41
Seoul|Seoul|KR|37.57|126.98
Harbin|Heilongjiang|CN|45.75|126.65
Tokyo|Tokyo|JP|35.69|139.69
Dongguan|Guangdong|CN|23.02|113.75
Cairo|Cairo|EG|30.06|31.25
Hefei|Anhui|CN|31.86|117.28
Johannesburg|Gauteng|ZA|-26.2|28.04
Weifang|Shandong|CN|36.71|119.1
Nanjing|Jiangsu|CN|32.06|118.78
Shenyang|Liaoning|CN|41.79|123.43
Foshan|Guangdong|CN|23.03|113.13
London|England|GB|51.51|-0.13
New York City|NY|US|40.71|-74.01
Jakarta|Jakarta|ID|-6.21|106.85
Bengaluru|Karnataka|IN|12.97|77.59
Jinan|Shandong|CN|36.67|117
Hanoi|Hanoi|VN|21.02|105.84
Taipei|Taiwan|TW|25.05|121.53
Lima|Lima Province|PE|-12.04|-77.03
Bogota|Bogota D.C.|CO|4.61|-74.08
Dalian|Liaoning|CN|38.91|121.6
Hong Kong||HK|22.28|114.17
Baghdad|Baghdad|IQ|33.34|44.4
Wuzhong|Ningxia|CN|37.99|106.2
Qingdao|Shandong|CN|36.06|120.38
Tehran|Tehran|IR|35.69|51.42
Yantai|Shandong|CN|37.48|121.44
Hyderabad|Telangana|IN|17.38|78.46
Rio de Janeiro|Rio de Janeiro|BR|-22.91|-43.18
Suzhou|Jiangsu|CN|31.3|120.6
Puxi|Shanghai|CN|31.24|121.47
Zhengzhou|Henan|CN|34.76|113.65
Ahmedabad|Gujarat|IN|23.03|72.59
Abidjan|Abidjan Autonomous District|CI|5.35|-4
Nanning|Guangxi|CN|22.82|108.32
Kunming|Yunnan|CN|25.04|102.72
Shijiazhuang|Hebei|CN|38.04|114.48
Changchun|Jilin|CN|43.88|125.32
Pudong|Shanghai|CN|31.24|121.5
Sydney|New South Wales|AU|-33.87|151.21
Singapore||SG|1.29|103.85
Melbourne|Victoria|AU|-37.81|144.96
Dar es Salaam|Dar es Salaam Region|TZ|-6.82|39.27
Saint Petersburg|St.-Petersburg|RU|59.94|30.31
Taiyuan|Shanxi|CN|37.87|112.56
Alexandria|Alexandria|EG|31.2|29.92
Bangkok|Bangkok|TH|13.75|100.5
Kano|Kano State|NG|12|8.52
Santiago|Santiago Metropolitan|CL|-33.46|-70.65
Cape Town|Western Cape|ZA|-33.93|18.42
Peshawar|Khyber Pakhtunkhwa|PK|34.01|71.58
Zibo|Shandong|CN|36.79|118.06
Jeddah|Mecca Region|SA|21.49|39.19
Chennai|Tamil Nadu|IN|13.09|80.28
Kolkata|West Bengal|IN|22.56|88.36
Xiamen|Fujian|CN|24.48|118.08
Surat|Gujarat|IN|21.2|72.83
Yangzhou|Jiangsu|CN|32.4|119.44
Huai'an|Jiangsu|CN|33.59|119.02
Guiyang|Guizhou|CN|26.58|106.72
Yangon|Yangon|MM|16.81|96.16
Bao'an|Guangdong|CN|22.55|113.88
Kabul|Kabul|AF|34.53|69.17
Nairobi|Nairobi County|KE|-1.28|36.82
Wuxi|Jiangsu|CN|31.57|120.29
Giza|Giza|EG|30.01|31.21
Lanzhou|Gansu|CN|36.06|103.84
Bamako|Bamako|ML|12.61|-7.98
Riyadh|Riyadh Region|SA|24.69|46.72
Fuzhou|Fujian|CN|26.06|119.31
UEruemqi|Xinjiang|CN|43.8|87.6
New Taipei City|Taipei|TW|25.06|121.46
New Territories||HK|22.42|114.11
Chattogram|Chittagong|BD|22.34|91.83
Addis Ababa|Addis Ababa|ET|9.02|38.75
Zaozhuang|Shandong|CN|34.86|117.55
Zhongshan|Guangdong|CN|22.52|113.38
Shantou|Guangdong|CN|23.35|116.68
Los Angeles|CA|US|34.05|-118.24
Faisalabad|Punjab|PK|31.42|73.09
Dubai|Dubai|AE|25.08|55.31
Yokohama|Kanagawa|JP|35.43|139.65
Ningbo|Zhejiang|CN|29.88|121.55
Nanhai|Guangdong|CN|23.02|113.14
Casablanca|Casablanca-Settat|MA|33.59|-7.61
Ibadan|Oyo State|NG|7.38|3.91
Puyang|Zhejiang|CN|29.46|119.89
Ankara|Ankara|TR|39.92|32.85
Shiyan|Hubei|CN|32.65|110.78
Hohhot|Inner Mongolia|CN|40.81|111.65
Berlin|State of Berlin|DE|52.52|13.41
Tangshan|Hebei|CN|39.64|118.18
Rawalpindi|Punjab|PK|33.6|73.05
Lueliang|Shanxi|CN|37.52|111.14
Durban|KwaZulu-Natal|ZA|-29.86|31.03
Anshan|Liaoning|CN|41.12|122.99
Changzhou|Jiangsu|CN|31.77|119.95
Busan|Busan|KR|35.1|129.03
Madrid|Madrid|ES|40.42|-3.7
Pyongyang|Pyongyang|KP|39.03|125.75
Pune|Maharashtra|IN|18.52|73.86
Datong|Shanxi|CN|40.09|113.29
Bursa|Bursa Province|TR|40.2|29.06
Changsha|Hunan|CN|28.2|112.97
Quezon City|National Capital Region|PH|14.65|121.05
Jaipur|Rajasthan|IN|26.92|75.79
Huainan|Anhui|CN|32.63|117
Surabaya|East Java|ID|-7.25|112.75
Incheon|Incheon|KR|37.46|126.71
Haikou|Hainan|CN|20.03|110.35
Caracas|Distrito Federal|VE|10.49|-66.88
Kyiv|Kyiv City|UA|50.45|30.52
Izmir|Izmir Province|TR|38.41|27.14
Huizhou|Guangdong|CN|23.11|114.42
Buenos Aires|Buenos Aires F.D.|AR|-34.61|-58.38
Yinchuan|Ningxia|CN|38.47|106.27
Taichung|Taiwan|TW|24.15|120.68
Kanpur|Uttar Pradesh|IN|26.47|80.35
Toronto|Ontario|CA|43.71|-79.4
Quito|Pichincha|EC|-0.23|-78.52
Brisbane|Queensland|AU|-27.47|153.03
Luanda|Luanda|AO|-8.84|13.23
Baotou|Inner Mongolia|CN|40.65|109.84
Osaka|Osaka|JP|34.69|135.5
Linyi|Shandong|CN|35.06|118.34
Baoding|Hebei|CN|38.87|115.46
Kaohsiung|Takao|TW|22.62|120.31
Brooklyn|NY|US|40.65|-73.95
Guayaquil|Guayas|EC|-2.2|-79.89
Belo Horizonte|Minas Gerais|BR|-19.92|-43.94
Minhang|Shanghai|CN|31.11|121.37
Bazhong|Sichuan|CN|31.87|106.74
Salvador|Bahia|BR|-12.98|-38.49
Abuja|FCT|NG|9.06|7.5
Gazipur|Dhaka Division|BD|24|90.42
Chicago|IL|US|41.85|-87.65
Wenzhou|Zhejiang|CN|28|120.67
Bekasi|West Java|ID|-6.23|106.99
Dakar|Dakar|SN|14.69|-17.44
Haiphong|Hai Phong|VN|20.86|106.68
Yunfu|Guangdong|CN|22.93|112.04
Navi Mumbai|Maharashtra|IN|19.04|73.02
Mogadishu|Banaadir|SO|2.04|45.34
Kumasi|Ashanti|GH|6.69|-1.62
Bandung|West Java|ID|-6.92|107.61
Gujranwala|Punjab|PK|32.16|74.19
Medan|North Sumatra|ID|3.58|98.67
Lucknow|Uttar Pradesh|IN|26.84|80.92
Xining|Qinghai|CN|36.63|101.76
Ouagadougou|Centre|BF|12.37|-1.53
Nagpur|Maharashtra|IN|21.15|79.08
Fortaleza|Ceara|BR|-3.72|-38.54
Cali|Valle del Cauca Department|CO|3.43|-76.52
Perth|Western Australia|AU|-31.95|115.86
Daegu|Daegu|KR|35.87|128.59
Algiers|Algiers|DZ|36.73|3.09
Nanchang|Jiangxi|CN|28.68|115.85
Baku|Baki|AZ|40.38|49.89
Nagoya|Aichi|JP|35.18|136.91
Rome|Lazio|IT|41.89|12.51
Queens|NY|US|40.68|-73.84
Houston|TX|US|29.76|-95.36
Mashhad|Razavi Khorasan|IR|36.3|59.61
Shaoxing|Zhejiang|CN|30|120.58
Nantong|Jiangsu|CN|32.03|120.87
Baoshan|Shanghai|CN|31.41|121.49
Kowloon||HK|22.32|114.18
Gaziantep|Gaziantep|TR|37.06|37.38
Lubumbashi|Haut-Katanga|CD|-11.66|27.48
Manaus|Amazonas|BR|-3.1|-60.02
Lusaka|Lusaka Province|ZM|-15.41|28.29
Brasilia|Federal District|BR|-15.78|-47.93
Zhuhai|Guangdong|CN|22.28|113.57
Santo Domingo|Nacional|DO|18.47|-69.89
Lome|Maritime|TG|6.13|1.22
Multan|Punjab|PK|30.2|71.48
Havana|Havana|CU|23.13|-82.38
Depok|West Java|ID|-6.4|106.82
Ordos|Inner Mongolia|CN|39.61|109.78
Paris|Ile-de-France|FR|48.85|2.35
Coimbatore|Tamil Nadu|IN|11.01|76.97
Qingyang|Gansu|CN|35.71|107.64
Port Harcourt|Rivers State|NG|4.78|7.01
Pretoria|Gauteng|ZA|-25.74|28.19
Cordoba|Cordoba|AR|-31.41|-64.19
Mbuji-Mayi|East Kasai|CD|-6.14|23.59
Aleppo|Aleppo|SY|36.2|37.16
Kunshan|Jiangsu|CN|31.38|120.95
Al Mawsil al Jadidah|Nineveh|IQ|36.33|43.11
Zunyi|Guizhou|CN|27.69|106.91
La Paz|La Paz Department|BO|-16.5|-68.15
Lianyungang|Jiangsu|CN|34.6|119.22
Medellin|Antioquia|CO|6.25|-75.57
Puning|Guangdong|CN|23.31|116.17
Indore|Madhya Pradesh|IN|22.72|75.83
Brazzaville|Brazzaville|CG|-4.27|15.28
Tashkent|Tashkent|UZ|41.26|69.22
Ganzhou|Jiangxi|CN|25.85|114.93
Almaty|Almaty|KZ|43.25|76.91
Khartoum|Khartoum|SD|15.55|32.53
Hamburg|Hamburg|DE|53.55|9.99
Sapporo|Hokkaido|JP|43.07|141.35
Songjiang|Shanghai|CN|31.03|121.22
Accra|Greater Accra|GH|5.56|-0.2
Curitiba|Parana|BR|-25.43|-49.27
Sanaa|Amanat Alasimah|YE|15.35|44.21
Conakry|Conakry|GN|9.54|-13.68
Tangerang|Banten|ID|-6.18|106.63
Tijuana|Baja California|MX|32.5|-117
Hyderabad|Sindh|PK|25.4|68.38
Beirut|Beirut|LB|33.89|35.5
Jieyang|Guangdong|CN|23.54|116.37
Jilin|Jilin|CN|43.85|126.56
Jiading|Shanghai|CN|31.39|121.24
Bucharest|Bucharest|RO|44.43|26.11
Camayenne|Conakry|GN|9.54|-13.69
Kakamega|Kakamega County|KE|0.28|34.75
Shangqiu|Henan|CN|34.41|115.66
Nanchong|Sichuan|CN|30.8|106.08
Tainan|Taiwan|TW|22.99|120.21
Kaduna|Kaduna State|NG|10.53|7.44
Omdurman|Khartoum|SD|15.64|32.48
Davao|Davao Region|PH|7.07|125.61
Thane|Maharashtra|IN|19.2|72.96
Iztapalapa|Mexico City|MX|19.36|-99.06
Diyarbakir|Diyarbakir Province|TR|37.91|40.22
Santa Cruz de la Sierra|Santa Cruz Department|BO|-17.79|-63.18
Vadodara|Gujarat|IN|22.3|73.21
Adana|Adana|TR|36.99|35.33
Nanyang|Henan|CN|33.01|112.55
Abu Dhabi|Abu Dhabi|AE|24.45|54.4
Palembang|South Sumatra|ID|-2.92|104.75
Sharjah|Sharjah|AE|25.33|55.41
Bhopal|Madhya Pradesh|IN|23.25|77.4
Jiangmen|Guangdong|CN|22.58|113.08
Benin City|Edo State|NG|6.34|5.63
Jiangyin|Jiangsu|CN|31.91|120.26
Fuyang|Anhui|CN|32.9|115.82
Montreal|Quebec|CA|45.51|-73.59
Bayan Nur|Inner Mongolia|CN|40.74|107.39
Chengtangcun|Shandong|CN|35.08|117.19
Maracaibo|Zulia|VE|10.64|-71.61
Chaozhou|Guangdong|CN|23.65|116.62
Minsk|Minsk City|BY|53.9|27.57
Budapest|Budapest|HU|47.5|19.04
Qingyuan|Guangdong|CN|23.7|113.03
Tai'an|Shandong|CN|36.19|117.12
Rasapudipalem|Andhra Pradesh|IN|17.73|83.32
Pimpri-Chinchwad|Maharashtra|IN|18.62|73.8
Caloocan|National Capital Region|PH|14.65|120.97
Warsaw|Mazovia|PL|52.23|21.01
Soweto|Gauteng|ZA|-26.27|27.86
Semarang|Central Java|ID|-6.99|110.42
Puebla|Puebla|MX|19.05|-98.21
Vienna|Vienna|AT|48.21|16.37
Barcelona|Catalonia|ES|41.39|2.16
Patna|Bihar|IN|25.59|85.14
Mosul|Nineveh|IQ|36.34|43.12
Kallakurichi|Tamil Nadu|IN|11.73|78.96
Kampala|Central Region|UG|0.32|32.58
Changshu|Jiangsu|CN|31.65|120.74
Rabat|Rabat-Sale-Kenitra|MA|34.01|-6.83
Recife|Pernambuco|BR|-8.05|-34.88
Phoenix|AZ|US|33.45|-112.07
Suzhou|Anhui|CN|33.64|116.98
Ecatepec de Morelos|Mexico|MX|19.6|-99.06
Lu'an|Anhui|CN|31.74|116.52
Valencia|Carabobo|VE|10.16|-68
Ludhiana|Punjab|IN|30.91|75.85
Yancheng|Jiangsu|CN|33.36|120.16
Novosibirsk|Novosibirsk Oblast|RU|55.02|82.93
Erbil|Erbil|IQ|36.19|44.01
Fukuoka|Fukuoka|JP|33.6|130.42
Taizhou|Jiangsu|CN|32.49|119.91
Daqing|Heilongjiang|CN|46.58|125
Kisangani|Tshopo|CD|0.52|25.19
Manila|National Capital Region|PH|14.6|120.98
Wuhu|Anhui|CN|31.35|118.43
Santiago de Queretaro|Queretaro|MX|20.59|-100.39
Dazhou|Sichuan|CN|31.21|107.46
Leon de los Aldama|Guanajuato|MX|21.12|-101.68
Makkah|Mecca Region|SA|21.43|39.83
Philadelphia|PA|US|39.95|-75.16
Phnom Penh|Phnom Penh|KH|11.56|104.92
Guilin|Guangxi|CN|25.28|110.3
Damascus|Damascus Governorate|SY|33.51|36.29
Quetta|Balochistan|PK|30.18|67
Zhaoqing|Guangdong|CN|23.05|112.46
Onitsha|Anambra|NG|6.15|6.79
Mianyang|Sichuan|CN|31.47|104.68
Auckland|Auckland|NZ|-36.85|174.76
Isfahan|Isfahan|IR|32.65|51.67
Wanzhou|Chongqing|CN|30.76|108.4
Astana|Astana|KZ|51.18|71.45
Harare|Harare|ZW|-17.83|31.05
Monrovia|Montserrado County|LR|6.3|-10.8
Putian|Fujian|CN|25.44|119.01
Kawasaki|Kanagawa|JP|35.52|139.72
Goiania|Goias|BR|-16.68|-49.25
San Antonio|TX|US|29.42|-98.49
Kobe|Hyogo|JP|34.69|135.18
Jinzhou|Liaoning|CN|41.11|121.14
Stockholm|Stockholm|SE|59.33|18.07
Ciudad Juarez|Chihuahua|MX|31.72|-106.46
Can Tho|Can Tho City|VN|10.04|105.79
Munich|Bavaria|DE|48.14|11.58
Khulna|Khulna Division|BD|22.81|89.56
Belem|Para|BR|-1.46|-48.5
Yekaterinburg|Sverdlovsk Oblast|RU|56.86|60.62
Porto Alegre|Rio Grande do Sul|BR|-30.03|-51.23
Manhattan|NY|US|40.78|-73.97
Nashik|Maharashtra|IN|20|73.79
Taizhou|Zhejiang|CN|28.66|121.43
Asuncion|Asuncion|PY|-25.29|-57.65
Yiwu|Zhejiang|CN|29.32|120.08
Zapopan|Jalisco|MX|20.72|-103.39
Makassar|South Sulawesi|ID|-5.15|119.43
Adelaide|South Australia|AU|-34.93|138.6
Quanzhou|Fujian|CN|24.91|118.59
Madurai|Tamil Nadu|IN|9.92|78.12
Jinhua|Zhejiang|CN|29.11|119.64
Kyoto|Kyoto|JP|35.02|135.75
Cixi|Zhejiang|CN|30.18|121.25
Changde|Hunan|CN|29.03|111.7
Kuala Lumpur|Kuala Lumpur|MY|3.14|101.69
Kayseri|Kayseri|TR|38.73|35.49
Kaifeng|Henan|CN|34.8|114.31
Karaj|Alborz Province|IR|35.83|50.99
Kathmandu|Bagmati Province|NP|27.7|85.32
Daejeon|Daejeon|KR|36.35|127.38
Baoji|Shaanxi|CN|34.37|107.24
Suqian|Jiangsu|CN|33.95|118.3
Liuzhou|Guangxi|CN|24.32|109.41
Tirunelveli|Tamil Nadu|IN|8.73|77.68
Konya|Konya|TR|37.87|32.48
Zhangjiagang|Jiangsu|CN|31.86|120.54
Agra|Uttar Pradesh|IN|27.18|78.02
South Tangerang|Banten|ID|-6.29|106.72
Tabriz|East Azerbaijan|IR|38.08|46.29
Kharkiv|Kharkiv|UA|49.98|36.25
Xinyang|Henan|CN|32.12|114.07
Jinjiang|Fujian|CN|24.82|118.57
Faridabad|Haryana|IN|28.41|77.31
Bozhou|Anhui|CN|33.88|115.77
Qujing|Yunnan|CN|25.48|103.78
San Diego|CA|US|32.72|-117.16
Gwangju|Gwangju|KR|35.15|126.92
Zhanjiang|Guangdong|CN|21.23|110.39
Fushun|Liaoning|CN|41.89|123.94
Rajkot|Gujarat|IN|22.29|70.79
Luoyang|Henan|CN|34.67|112.44
Guadalajara|Jalisco|MX|20.68|-103.35
The Bronx|NY|US|40.85|-73.87
Guankou|Hunan|CN|28.16|113.63
Hue|Thua Thien Hue Province|VN|16.46|107.6
Milan|Lombardy|IT|45.46|9.19
Najafgarh|Delhi|IN|28.61|76.98
Lianjiang|Guangdong|CN|21.65|110.28
N'Djamena|N'Djamena|TD|12.11|15.04
Handan|Hebei|CN|36.61|114.49
Bannu|Khyber Pakhtunkhwa|PK|32.99|70.6
Yichang|Hubei|CN|30.71|111.28
Antananarivo|Analamanga|MG|-18.91|47.54
Heze|Shandong|CN|35.24|115.47
Guarulhos|Sao Paulo|BR|-23.46|-46.53
Abobo|Abidjan Autonomous District|CI|5.42|-4.02
Jamshedpur|Jharkhand|IN|22.8|86.19
Douala|Littoral|CM|4.05|9.7
Antalya|Antalya|TR|36.91|30.7
Basrah|Basra|IQ|30.51|47.78
Dallas|TX|US|32.78|-96.81
Saitama|Saitama|JP|35.91|139.66
Niamey|Niamey|NE|13.51|2.11
Liupanshui|Guizhou|CN|26.59|104.83
Taguig|National Capital Region|PH|14.52|121.08
Maoming|Guangdong|CN|21.67|110.91
Calgary|Alberta|CA|51.05|-114.09
Tripoli|Tripoli|LY|32.89|13.19
Madinah|Medina Region|SA|24.47|39.61
Yaounde|Centre|CM|3.87|11.52
Batam|Riau|ID|1.15|104.02
Qinzhou|Guangxi|CN|21.98|108.65
Luohe|Henan|CN|33.57|114.03
Xiangyang|Hubei|CN|32.04|112.14
Yangjiang|Guangdong|CN|21.86|111.96
Yixing|Jiangsu|CN|31.36|119.82
Pimpri|Maharashtra|IN|18.62|73.81
Da Nang|Da Nang City|VN|16.07|108.22
Amman|Amman|JO|31.96|35.95
Budta|Autonomous Region in Muslim Mindanao|PH|7.2|124.44
Belgrade|Central Serbia|RS|44.8|20.47
Bien Hoa|Dong Nai|VN|10.94|106.82
Kananga|Kasai-Central|CD|-5.9|22.42
Qingpu|Shanghai|CN|31.15|121.11
Montevideo|Montevideo Department|UY|-34.9|-56.19
Xuchang|Henan|CN|34.03|113.86
Kalyan|Maharashtra|IN|19.24|73.14
Zigong|Sichuan|CN|29.34|104.78
Nizhniy Novgorod|Nizhny Novgorod Oblast|RU|56.33|44
Jepara|Central Java|ID|-6.59|110.67
Maputo|Maputo City|MZ|-25.97|32.58
Xuzhou|Jiangsu|CN|34.2|117.28
Dammam|Eastern Province|SA|26.43|50.1
Ra's Bayrut|Beirut|LB|33.9|35.48
Neijiang|Sichuan|CN|29.58|105.06
Shiraz|Fars|IR|29.61|52.53
Heshan|Hunan|CN|28.57|112.35
Dombivali|Maharashtra|IN|19.22|73.08
Kazan|Tatarstan Republic|RU|55.79|49.12
Jining|Shandong|CN|35.41|116.58
Barquisimeto|Lara|VE|10.06|-69.36
Shubra al Khaymah|Qalyubia|EG|30.13|31.25
Putuo|Shanghai|CN|31.25|121.39
Port-au-Prince|Ouest|HT|18.54|-72.34
Suwon|Gyeonggi-do|KR|37.29|127.01
Liaocheng|Shandong|CN|36.45|116
Jinzhong|Shanxi|CN|37.68|112.75
Callao|Callao|PE|-12.05|-77.13
Meerut|Uttar Pradesh|IN|28.98|77.71
Virar|Maharashtra|IN|19.46|72.81
Nowrangapur|Odisha|IN|19.23|82.55
Karbala|Karbala|IQ|32.62|44.02
Changzhi|Shanxi|CN|36.18|113.11
Tianshui|Gansu|CN|34.58|105.74
Sadr City|Baghdad|IQ|33.39|44.46
Yangpu|Shanghai|CN|31.26|121.52
Mombasa|Mombasa County|KE|-4.05|39.66
Mandalay|Mandalay Region|MM|21.97|96.08
Srinagar|Jammu and Kashmir|IN|34.09|74.81
Barranquilla|Atlantico|CO|10.97|-74.78
Chelyabinsk|Chelyabinsk|RU|55.16|61.43
Merida|Yucatan|MX|20.97|-89.62
Hiroshima|Hiroshima|JP|34.4|132.45
Santiago de los Caballeros|Santiago Province|DO|19.45|-70.69
Shymkent|Shymkent|KZ|42.31|69.6
Weinan|Shaanxi|CN|34.5|109.51
Ghaziabad|Uttar Pradesh|IN|28.67|77.44
Matola|Maputo Province|MZ|-25.96|32.46
Dhanbad|Jharkhand|IN|23.8|86.43
Arequipa|Arequipa|PE|-16.4|-71.54
Hong Kong Island||HK|22.26|114.18
Fes|Fes-Meknes|MA|34.03|-5
Gustavo Adolfo Madero|Mexico City|MX|19.49|-99.11
Nouakchott||MR|18.09|-15.98
Jiaxing|Zhejiang|CN|30.75|120.75
Aurangabad|Maharashtra|IN|19.88|75.34
Zhongwei|Ningxia|CN|37.51|105.19
Omsk|Omsk Oblast|RU|54.99|73.37
Pikine|Dakar|SN|14.76|-17.39
Pekanbaru|Riau|ID|0.52|101.44
Panjin|Liaoning|CN|41.12|122.07
Bandar Lampung|Lampung|ID|-5.43|105.26
Prague|Prague|CZ|50.09|14.42
Varanasi|Uttar Pradesh|IN|25.32|83.01
Jiujiang|Jiangxi|CN|29.7|116
Samara|Samara Oblast|RU|53.21|50.14
Aba|Abia State|NG|5.11|7.37
Amritsar|Punjab|IN|31.62|74.88
Birmingham|England|GB|52.48|-1.9
Copenhagen|Capital Region|DK|55.68|12.57
Sofia|Sofia-Capital|BG|42.7|23.32
Anyang|Henan|CN|36.1|114.38
Yerevan|Yerevan|AM|40.18|44.51
Luohu District|Guangdong|CN|22.55|114.13
Vijayawada|Andhra Pradesh|IN|16.51|80.65
Fengxiang|Shanghai|CN|30.86|121.47
Bijie|Guizhou|CN|27.3|105.29
Monterrey|Nuevo Leon|MX|25.68|-100.32
Kigali|Kigali|RW|-1.95|30.06
Rostov-on-Don|Rostov|RU|47.22|39.71
Zhuzhou|Hunan|CN|27.83|113.15
Rui'an|Zhejiang|CN|27.78|120.66
Malingao|Soccsksargen|PH|7.16|124.47
Touba|Diourbel Region|SN|14.86|-15.88
Ufa|Bashkortostan Republic|RU|54.74|55.97
Ranchi|Jharkhand|IN|23.34|85.31
Zoucheng|Shandong|CN|35.4|116.97
Shangrao|Jiangxi|CN|28.45|117.94
Lilongwe|Central Region|MW|-13.97|33.79
Huaibei|Anhui|CN|33.97|116.79
Maiduguri|Borno State|NG|11.85|13.16
Xuhui|Shanghai|CN|31.2|121.45
Meishan|Sichuan|CN|30.04|103.84
Mwanza|Mwanza|TZ|-2.52|32.9
Wuchang|Hubei|CN|30.54|114.3
Ulsan|Ulsan|KR|35.54|129.32
Sendai|Miyagi|JP|38.27|140.87
Krasnoyarsk|Krasnoyarsk Krai|RU|56.04|92.93
Fuzhou|Jiangxi|CN|27.96|116.33
Guigang|Guangxi|CN|23.12|109.59
Oslo|Oslo|NO|59.91|10.75
Jabalpur|Madhya Pradesh|IN|23.17|79.95
Ilorin|Kwara State|NG|8.5|4.54
Aden|Aden|YE|12.78|45.04
Bogor|West Java|ID|-6.59|106.79
Ciudad Nezahualcoyotl|Mexico|MX|19.4|-99.01
Hengyang|Hunan|CN|26.89|112.62
Prayagraj|Uttar Pradesh|IN|25.44|81.84
Trujillo|La Libertad|PE|-8.12|-79.03
Visakhapatnam|Andhra Pradesh|IN|17.68|83.2
Goyang-si|Gyeonggi-do|KR|37.66|126.83
Yulin|Guangxi|CN|22.63|110.15
Jodhpur|Rajasthan|IN|26.27|73.01
Gwalior|Madhya Pradesh|IN|26.23|78.17
Jingzhou|Hubei|CN|30.35|112.19
Gqeberha|Eastern Cape|ZA|-33.96|25.61
Tbilisi|Tbilisi|GE|41.69|44.83
Voronezh|Voronezh Oblast|RU|51.67|39.19
Xinxiang|Henan|CN|35.19|113.8
Yichun|Jiangxi|CN|27.83|114.4
Sokoto|Sokoto|NG|13.06|5.24
Jos|Plateau State|NG|9.93|8.89
Tangier|Tanger-Tetouan-Al Hoceima|MA|35.77|-5.8
Teni|Tamil Nadu|IN|10.01|77.48
Xianyang|Shaanxi|CN|34.34|108.7
Mexicali|Baja California|MX|32.63|-115.45
Pointe-Noire|Pointe-Noire|CG|-4.78|11.86
Maceio|Alagoas|BR|-9.67|-35.74
Campinas|Sao Paulo|BR|-22.91|-47.06
Sanya|Hainan|CN|18.25|109.51
Rangpur|Rangpur Division|BD|25.75|89.25
Kirkuk|Kirkuk|IQ|35.47|44.39
Ashgabat|Ashgabat|TM|37.95|58.38
Shaoguan|Guangdong|CN|24.8|113.58
Howrah|West Bengal|IN|22.58|88.32
Raipur|Chhattisgarh|IN|21.23|81.63
Changwon|Gyeongsangnam-do|KR|35.23|128.68
Longyan|Fujian|CN|25.07|117.02
Koeln|North Rhine-Westphalia|DE|50.93|6.95
Dublin|Leinster|IE|53.33|-6.25
Tiruchirappalli|Tamil Nadu|IN|10.82|78.7
Yongzhou|Hunan|CN|26.42|111.61
Brussels|Brussels Capital|BE|50.85|4.35
Zamboanga|Zamboanga Peninsula|PH|6.91|122.07
Ottawa|Ontario|CA|45.41|-75.7
Huzhou|Zhejiang|CN|30.87|120.09
Xinyi|Guangdong|CN|22.37|110.95
Volgograd|Volgograd Oblast|RU|48.71|44.5
Khartoum North|Khartoum|SD|15.65|32.53
Edmonton|Alberta|CA|53.55|-113.47
Odesa|Odesa|UA|46.49|30.74
Wuwei|Gansu|CN|37.93|102.63
Jacksonville|FL|US|30.33|-81.66
Fort Worth|TX|US|32.73|-97.32
Yishui|Shandong|CN|35.78|118.63
Hanzhong|Shaanxi|CN|33.08|107.02
Hezhou|Guangxi|CN|24.4|111.57
Pest|Budapest|HU|47.5|19.08
Kota|Rajasthan|IN|25.18|75.84
Zhu Cheng City|Shandong|CN|36|119.4
Shivaji Nagar|Maharashtra|IN|18.53|73.85
Dongying|Shandong|CN|37.46|118.49
Luzhou|Sichuan|CN|28.89|105.43
San Jose|CA|US|37.34|-121.89
Sholapur|Maharashtra|IN|17.67|75.91
Marrakesh|Marrakesh-Safi|MA|31.63|-8
Guatemala City|Guatemala|GT|14.64|-90.51
Meizhou|Guangdong|CN|24.29|116.12
Yueyang|Hunan|CN|29.37|113.09
Laiwu|Shandong|CN|36.19|117.66
Esenyurt|Istanbul|TR|41.03|28.68
Perm|Perm Krai|RU|58.01|56.25
Zaria|Kaduna State|NG|11.11|7.72
Kennedy|Bogota D.C.|CO|4.62|-74.15
Chiba|Chiba|JP|35.6|140.12
Pingdingshan|Henan|CN|33.73|113.32
Ciudad Guayana|Bolivar|VE|8.35|-62.64
Sargodha|Punjab|PK|32.09|72.67
Austin|TX|US|30.27|-97.74
Managua|Managua Department|NI|12.13|-86.25
Bengbu|Anhui|CN|32.94|117.36
Sale|Rabat-Sale-Kenitra|MA|34.05|-6.8
Jerusalem|Jerusalem|IL|31.77|35.22
Chandigarh|Chandigarh|IN|30.74|76.79
Dnipro|Dnipropetrovsk|UA|48.47|35.04
Feicheng|Shandong|CN|36.25|116.77
Cebu City|Central Visayas|PH|10.32|123.89
Sanhe|Hebei|CN|39.98|117.07
Guli|Zhejiang|CN|28.88|120.03
Tiruppur|Tamil Nadu|IN|11.12|77.35
Guwahati|Assam|IN|26.18|91.75
Xiangtan|Hunan|CN|27.85|112.9
Linfen|Shanxi|CN|36.09|111.52
Victoria|Central and Western|HK|22.29|114.14
Zhenjiang|Jiangsu|CN|32.21|119.46
Enugu|Enugu State|NG|6.44|7.5
Rosario|Santa Fe|AR|-32.95|-60.64
Sultanah|Medina Region|SA|24.49|39.59
Huludao|Liaoning|CN|40.75|120.84
Hubballi|Karnataka|IN|15.35|75.13
Padang|West Sumatra|ID|-0.95|100.35
Kitakyushu|Fukuoka|JP|33.85|130.85
Taiz|Ta'izz|YE|13.58|44.02
Setagaya|Tokyo|JP|35.64|139.65
Kingston|Kingston|JM|18|-76.79
Jing'an|Shanghai|CN|31.22|121.42
Baoshan|Yunnan|CN|25.12|99.16
Chihuahua|Chihuahua|MX|28.64|-106.09
Nay Pyi Taw|Nay Pyi Taw|MM|19.75|96.13
Eskisehir|Eskisehir|TR|39.78|30.52
Mysuru|Karnataka|IN|12.3|76.64
Chengde|Hebei|CN|40.95|117.96
Salem|Tamil Nadu|IN|11.65|78.16
Sao Luis|Maranhao|BR|-2.53|-44.3
Seongnam-si|Gyeonggi-do|KR|37.44|127.14
Cartagena|Bolivar|CO|10.4|-75.49
Antipolo|Calabarzon|PH|14.63|121.12
Columbus|OH|US|39.96|-83
Sialkot|Punjab|PK|32.49|74.53
Charlotte|NC|US|35.23|-80.84
Laibin|Guangxi|CN|23.75|109.22
Warri|Delta|NG|5.52|5.75
Naples|Campania|IT|40.85|14.27
Xiaogan|Hubei|CN|30.93|113.92
Wuchuan|Guangdong|CN|21.46|110.77
Campo Grande|Mato Grosso do Sul|BR|-20.44|-54.65
Ziyang|Sichuan|CN|30.12|104.65
Bobo-Dioulasso|Hauts-Bassins|BF|11.18|-4.29
Bahawalpur|Punjab|PK|29.4|71.68
Quzhou|Zhejiang|CN|28.96|118.87
Blantyre|Southern Region|MW|-15.78|35.01
Donetsk|Donetsk|UA|48.02|37.8
Abu Ghurayb|Baghdad|IQ|33.31|44.18
Qom|Qom Province|IR|34.64|50.88
Bishkek|Bishkek|KG|42.87|74.59
Krasnodar|Krasnodar Krai|RU|45.05|38.98
Natal|Rio Grande do Norte|BR|-5.79|-35.21
Pingxiang|Jiangxi|CN|27.62|113.85
Malang|East Java|ID|-7.98|112.63
Cancun|Quintana Roo|MX|21.17|-86.85
Indianapolis|IN|US|39.77|-86.16
Gurugram|Haryana|IN|28.46|77.03
Bhubaneswar|Odisha|IN|20.27|85.83
Zhoushan|Zhejiang|CN|29.99|122.2
Qiqihar|Heilongjiang|CN|47.34|123.96
Mulenvos|Luanda|AO|-8.87|13.33
Sulaymaniyah|Sulaymaniyah|IQ|35.56|45.43
Marseille|Provence-Alpes-Cote d'Azur|FR|43.3|5.38
Bhiwandi|Maharashtra|IN|19.3|73.06
Soshanguve|Gauteng|ZA|-25.47|28.1
Laiyang|Shandong|CN|36.98|120.71
Daye|Hubei|CN|30.08|114.95
Teresina|Piaui|BR|-5.09|-42.8
Ankang|Shaanxi|CN|32.68|109.02
Jalandhar|Punjab|IN|31.33|75.58
Rotterdam|South Holland|NL|51.92|4.48
Langfang|Hebei|CN|39.52|116.71
Lhasa|Tibet|CN|29.65|91.1
Duque de Caxias|Rio de Janeiro|BR|-22.79|-43.31
Viana|Luanda|AO|-8.91|13.37
Jiaozuo|Henan|CN|35.24|113.24
Samarinda|East Kalimantan|ID|-0.49|117.15
Benxi|Liaoning|CN|41.29|123.77
Rohini|Delhi|IN|28.74|77.07
Wanxian|Chongqing|CN|30.82|108.37
Guang'an|Sichuan|CN|30.47|106.64
Johor Bahru|Johor|MY|1.47|103.76
Arifwala|Punjab|PK|30.29|73.07
Pasig City|National Capital Region|PH|14.59|121.06
Cheongju-si|North Chungcheong|KR|36.64|127.49
Kanayannur|Kerala|IN|9.97|76.27
Tegucigalpa|Francisco Morazan Department|HN|14.08|-87.21
Bucheon-si|Gyeonggi-do|KR|37.5|126.78
Thanh Hoa|Thanh Hoa Province|VN|19.8|105.77
Turin|Piedmont|IT|45.07|7.69
Al Ain City|Abu Dhabi|AE|24.19|55.76
Libreville|Estuaire|GA|0.39|9.45
Saratov|Saratov Oblast|RU|51.54|45.99
Ulan Bator|Ulaanbaatar|MN|47.91|106.88
Weihai|Shandong|CN|37.51|122.11
Takeo|Takeo|KH|10.99|104.78
Nova Iguacu|Rio de Janeiro|BR|-22.76|-43.45
Cochabamba|Cochabamba|BO|-17.38|-66.16
Ahvaz|Khuzestan|IR|31.32|48.68
Vientiane|Vientiane Prefecture|LA|17.97|102.6
Sao Bernardo do Campo|Sao Paulo|BR|-23.69|-46.56
Zhabei|Shanghai|CN|31.26|121.46
Shangyu|Zhejiang|CN|30.02|120.87
Xinyu|Jiangxi|CN|27.8|114.93
Pietermaritzburg|KwaZulu-Natal|ZA|-29.62|30.39
Yibin|Sichuan|CN|28.76|104.64
Naucalpan de Juarez|Mexico|MX|19.48|-99.24
Kampung Baru Subang|Selangor|MY|3.15|101.53
Bouake|Vallee du Bandama District|CI|7.69|-5.03
Taicang|Jiangsu|CN|31.45|121.09
San Francisco|CA|US|37.77|-122.42
Sakai|Osaka|JP|34.58|135.47
Jiaojiang|Zhejiang|CN|28.7|121.47
Valencia|Valencia|ES|39.47|-0.38
Jinshan|Shanghai|CN|30.84|121.29
Chenzhou|Hunan|CN|25.8|113.03
Joao Pessoa|Paraiba|BR|-7.12|-34.86
Bukavu|South Kivu|CD|-2.49|28.84
Krakow|Lesser Poland|PL|50.06|19.94
Dandong|Liaoning|CN|40.13|124.39
Barcelona|Anzoategui|VE|10.14|-64.69
Bangui|Bangui|CF|4.36|18.55
Hermosillo|Sonora|MX|29.09|-110.97
Bhayandar|Maharashtra|IN|19.3|72.85
Culiacan|Sinaloa|MX|24.8|-107.39
Petaling Jaya|Selangor|MY|3.11|101.61
Anqing|Anhui|CN|30.51|117.05
Oran|Oran|DZ|35.7|-0.64
Freetown|Western Area|SL|8.49|-13.24
San Pedro Sula|Cortes Department|HN|15.51|-88.03
Narela|Delhi|IN|28.85|77.09
Xingtai|Hebei|CN|37.06|114.49
Niigata|Niigata|JP|37.92|139.04
Muscat|Muscat|OM|23.58|58.41
Zarqa|Zarqa|JO|32.07|36.09
Cankaya|Ankara|TR|39.92|32.86
Kuecuekcekmece|Istanbul|TR|40.99|28.77
Hamamatsu|Shizuoka|JP|34.7|137.73
Kolwezi|Lualaba|CD|-10.71|25.47
Vinh|Nghe An Province|VN|18.67|105.69
Thiruvananthapuram|Kerala|IN|8.49|76.95
Zhaotong|Yunnan|CN|27.32|103.72
Hondlon|Inner Mongolia|CN|40.65|109.79
Panzhihua|Sichuan|CN|26.59|101.71
Chuzhou|Anhui|CN|32.32|118.3
Seattle|WA|US|47.61|-122.33
Port Said|Port Said|EG|31.27|32.3
Cucuta|Norte de Santander Department|CO|7.91|-72.5
Homs|Homs|SY|34.72|36.73
Xuancheng|Anhui|CN|30.95|118.76
Ibb|Ibb Governorate|YE|13.97|44.18
Tasikmalaya|West Java|ID|-7.33|108.22
Nampula|Nampula|MZ|-15.12|39.27
Bujumbura|Bujumbura Mairie|BI|-3.38|29.36
Tyumen|Tyumen Oblast|RU|57.15|65.53
Erzurum|Erzurum|TR|39.91|41.28
Anshun|Guizhou|CN|26.25|105.93
Dodoma|Dodoma|TZ|-6.17|35.74
Rajshahi|Rajshahi Division|BD|24.37|88.6
Dera Ismail Khan|Khyber Pakhtunkhwa|PK|31.83|70.9
Sorocaba|Sao Paulo|BR|-23.5|-47.46
Wuzhou|Guangxi|CN|23.48|111.29
Ipoh|Perak|MY|4.58|101.08
Qinhuangdao|Hebei|CN|39.94|119.59
Benghazi|Banghazi|LY|32.11|20.07
Uberlandia|Minas Gerais|BR|-18.92|-48.28
Aligarh|Uttar Pradesh|IN|27.88|78.07
Shaoyang|Hunan|CN|27.24|111.46
Malatya|Malatya|TR|38.35|38.32
Winnipeg|Manitoba|CA|49.88|-97.15
Ota|Tokyo|JP|35.56|139.72
Andijon|Andijan Region|UZ|40.78|72.35
Bareilly|Uttar Pradesh|IN|28.37|79.43
Buraydah|Al-Qassim Region|SA|26.33|43.97
Hegang|Heilongjiang|CN|47.35|130.29
Morelia|Michoacan|MX|19.7|-101.18
Riga|Riga|LV|56.95|24.11
Zhuanghe|Liaoning|CN|39.7|122.99
Amsterdam|North Holland|NL|52.37|4.89
Cagayan de Oro|Northern Mindanao|PH|8.48|124.65
Ma'anshan|Anhui|CN|31.69|118.51
Shah Alam|Selangor|MY|3.09|101.53
Bagcilar|Istanbul|TR|41.04|28.86
Shizuishan|Ningxia|CN|38.98|106.39
Kumamoto|Kumamoto|JP|32.81|130.69
Oyo|Oyo State|NG|7.85|3.93
Serang|Banten|ID|-6.12|106.15
Torreon|Coahuila|MX|25.54|-103.42
Deyang|Sichuan|CN|31.13|104.38
Abeokuta|Ogun State|NG|7.16|3.35
Al Hudaydah|Al Hudaydah|YE|14.8|42.95
Yangquan|Shanxi|CN|37.86|113.56
Akure|Ondo State|NG|7.25|5.19
Denver|CO|US|39.74|-104.98
Osasco|Sao Paulo|BR|-23.53|-46.79
Kikolo|Luanda|AO|-8.78|13.33
Maianga|Luanda|AO|-8.85|13.24
Sao Jose dos Campos|Sao Paulo|BR|-23.18|-45.89
Alvaro Obregon|Mexico City|MX|19.36|-99.2
Aihara|Kanagawa|JP|35.6|139.32
Evaton|Gauteng|ZA|-26.53|27.85
Valenzuela|National Capital Region|PH|14.7|120.97
Muzaffarabad|Azad Kashmir|PK|34.37|73.47
Okayama|Okayama|JP|34.65|133.93
San Luis Potosi|San Luis Potosi|MX|22.15|-100.97
Aguascalientes|Aguascalientes|MX|21.88|-102.28
General Santos|Soccsksargen|PH|6.11|125.17
Zhumadian|Henan|CN|32.98|114.03
Moradabad|Uttar Pradesh|IN|28.84|78.78
Sagamihara|Kanagawa|JP|35.57|139.24
Qingshan|Inner Mongolia|CN|40.66|109.88
Mississauga|Ontario|CA|43.58|-79.66
Lviv|Lviv|UA|49.84|24.02
Namangan|Namangan|UZ|41|71.67
Zaporizhzhya|Zaporizhzhia|UA|47.85|35.12
Zanzibar|Zanzibar Urban/West|TZ|-6.16|39.2
Saltillo|Coahuila|MX|25.43|-100.98
Latakia|Latakia|SY|35.53|35.79
Subang Jaya|Selangor|MY|3.04|101.58
Warangal|Telangana|IN|18|79.58
Paranaque City|National Capital Region|PH|14.48|121.02
Tolyatti|Samara Oblast|RU|53.53|49.35
Santo Domingo Oeste|Santo Domingo Province|DO|18.5|-70
Santo Domingo Este|Santo Domingo Province|DO|18.49|-69.85
Dharavi|Maharashtra|IN|19.05|72.87
Battagram|Khyber Pakhtunkhwa|PK|34.68|73.02
Suez|Suez|EG|29.97|32.53
Ribeirao Preto|Sao Paulo|BR|-21.18|-47.81
Agadir|Souss-Massa|MA|30.42|-9.6
Edogawe|Tokyo|JP|35.69|139.87
Sarajevo|Federation of B&H|BA|43.85|18.36
Balikpapan|East Kalimantan|ID|-1.27|116.83
Adachi|Tokyo|JP|35.76|139.81
Changning|Shanghai|CN|31.22|121.42
Bauchi|Bauchi|NG|10.31|9.84
Shizuoka|Shizuoka|JP|34.98|138.38
Tunis|Tunis Governorate|TN|36.82|10.17
Zhangjiakou|Hebei|CN|40.78|114.87
Washington|DC|US|38.9|-77.04
Nashville|TN|US|36.17|-86.78
Fuxin|Liaoning|CN|42.02|121.66
Ta'if|Mecca Region|SA|21.27|40.42
Changsha|Guangdong|CN|22.38|112.68
Huangshi|Hubei|CN|30.25|115.05
Liaoyang|Liaoning|CN|41.27|123.17
Hlaingthaya|Yangon|MM|16.85|96.07
Beira|Sofala|MZ|-19.84|34.84
Hongkou|Shanghai|CN|31.25|121.49
Zaragoza|Aragon|ES|41.66|-0.88
Sevilla|Andalusia|ES|37.38|-5.97
Baise|Guangxi|CN|23.89|106.63
Pontianak|West Kalimantan|ID|-0.03|109.33
Situbondo|East Java|ID|-7.71|114.01
Agege|Lagos|NG|6.62|3.33
Binzhou|Shandong|CN|37.37|118.02
Oklahoma City|OK|US|35.47|-97.52
Yuncheng|Shanxi|CN|35.02|110.99
Dezhou|Shandong|CN|37.45|116.37
Dushanbe|Dushanbe|TJ|38.54|68.78
Cotonou|Littoral|BJ|6.37|2.42
El Paso|TX|US|31.76|-106.49
Gorakhpur|Uttar Pradesh|IN|26.77|83.37
Guadalupe|Nuevo Leon|MX|25.68|-100.26
Wroclaw|Lower Silesia|PL|51.1|17.03
Denpasar|Bali|ID|-8.65|115.22
Guntur|Andhra Pradesh|IN|16.3|80.46
Katsina|Katsina State|NG|12.99|7.6
Sanmenxia|Henan|CN|34.78|111.19
E'zhou|Hubei|CN|30.4|114.89
Madinat an Nasr|Cairo|EG|30.07|31.3
Camama|Luanda|AO|-8.94|13.27
Tabuk|Tabuk Region|SA|28.4|36.57
Kitwe|Copperbelt|ZM|-12.8|28.21
Bulawayo|Bulawayo|ZW|-20.15|28.58
Mudanjiang|Heilongjiang|CN|44.55|129.63
Aracaju|Sergipe|BR|-10.91|-37.07
Joinville|Santa Catarina|BR|-26.3|-48.85
Athens|Attica|GR|37.98|23.73
Zagreb|Zagreb|HR|45.81|15.98
Leshan|Sichuan|CN|29.56|103.76
Santo Andre|Sao Paulo|BR|-23.66|-46.54
Vancouver|British Columbia|CA|49.25|-123.12
Rizhao|Shandong|CN|35.41|119.53
Helsinki|Uusimaa|FI|60.17|24.94
Cheonan|Chungcheongnam-do|KR|36.81|127.15
Acapulco de Juarez|Guerrero|MX|16.85|-99.91
Dongcun|Shandong|CN|36.78|121.16
Banjarmasin|South Kalimantan|ID|-3.32|114.59
Puducherry|Puducherry|IN|11.93|79.83
Suining|Sichuan|CN|30.51|105.57
Brampton|Ontario|CA|43.68|-79.77
Huangpu|Shanghai|CN|31.24|121.48
Golfe|Luanda|AO|-8.87|13.26
Puyang|Henan|CN|35.76|115.04
Soacha|Cundinamarca|CO|4.58|-74.22
Boston|MA|US|42.36|-71.06
Tlalnepantla|Mexico|MX|19.54|-99.2
Jajmau|Uttar Pradesh|IN|26.43|80.41
Portland|OR|US|45.52|-122.68
Calumbo|Bengo|AO|-9.15|13.42
Tlaquepaque|Jalisco|MX|20.64|-103.29
Frankfurt am Main|Hesse|DE|50.12|8.68
Macau||MO|22.2|113.55
Palermo|Sicily|IT|38.12|13.36
Izhevsk|Udmurtiya Republic|RU|56.85|53.2
Colombo|Western Province|LK|6.94|79.85
Maturin|Monagas|VE|9.75|-63.18
Amravati|Maharashtra|IN|20.93|77.75
Lingyuan|Liaoning|CN|41.24|119.4
Detroit|MI|US|42.33|-83.05
Mingguang|Anhui|CN|32.78|117.96
Osogbo|Osun State|NG|7.77|4.56
Honcho|Chiba|JP|35.7|139.99
Bikaner|Rajasthan|IN|28.02|73.31
Jaboatao dos Guararapes|Pernambuco|BR|-8.11|-35.01
Hoji ya Henda|Luanda|AO|-8.81|13.29
Las Vegas|NV|US|36.17|-115.14
New South Memphis|TN|US|35.09|-90.06
Hwaseong-si|Gyeonggi-do|KR|37.21|126.82
Gold Coast|Queensland|AU|-28|153.43
Lodz|Lodz Voivodeship|PL|51.77|19.47
Jeonju|Jeollabuk-do|KR|35.82|127.15
Chongming||CN|31.62|121.7
Al Ahmadi|Al Ahmadi|KW|29.08|48.08
Cuenca|Azuay|EC|-2.9|-79
Chisinau|Chisinau Municipality|MD|47.01|28.86
Likasi|Haut-Katanga|CD|-10.98|26.74
Jambi City|Jambi|ID|-1.6|103.62
Hebi|Henan|CN|35.73|114.29
Comilla|Chittagong|BD|23.46|91.19
Tshikapa|Kasai|CD|-6.42|20.8
Chunian|Punjab|PK|30.97|73.98
Kochi|Kerala|IN|9.94|76.26
Memphis|TN|US|35.15|-90.05
Jingmen|Hubei|CN|31.03|112.2
Barnaul|Altai Krai|RU|53.36|83.73
Piura|Piura|PE|-5.18|-80.66
Siping|Jilin|CN|43.16|124.38
Bhilai|Chhattisgarh|IN|21.21|81.43
Ndola|Copperbelt|ZM|-12.96|28.64
Contagem|Minas Gerais|BR|-19.93|-44.05
Ulyanovsk|Ulyanovsk|RU|54.33|48.39
Djibouti|Djibouti|DJ|11.59|43.15
Glasgow|Scotland|GB|55.87|-4.26
Panshan|Liaoning|CN|41.19|122.05
Louisville|KY|US|38.25|-85.76
Irkutsk|Irkutsk Oblast|RU|52.3|104.29
Ansan-si|Gyeonggi-do|KR|37.32|126.82
Al Mansurah|Dakahlia|EG|31.04|31.38
Kermanshah|Kermanshah Province|IR|34.31|47.06
Jiaozhou|Shandong|CN|36.28|120
Duesseldorf|North Rhine-Westphalia|DE|51.22|6.78
Suizhou|Hubei|CN|31.71|113.36
Villa Nueva|Guatemala|GT|14.53|-90.59
Khabarovsk|Khabarovsk|RU|48.46|135.1
Cuiaba|Mato Grosso|BR|-15.6|-56.1
Arusha|Arusha|TZ|-3.37|36.68
Feira de Santana|Bahia|BR|-12.27|-38.97
Las Pinas|National Capital Region|PH|14.45|120.98
Chizhou|Anhui|CN|30.66|117.48
Coyoacan|Mexico City|MX|19.35|-99.16
Stuttgart|Baden-Wurttemberg|DE|48.78|9.18
Ya'an|Sichuan|CN|29.99|103
Cuttack|Odisha|IN|20.46|85.88
Borivli|Maharashtra|IN|19.23|72.86
Chiclayo|Lambayeque|PE|-6.77|-79.85
Yaroslavl|Yaroslavl Oblast|RU|57.63|39.87
Gothenburg|Vaestra Goetaland|SE|57.71|11.97
Kawaguchi|Saitama|JP|35.81|139.71
Bukit Rahman Putra|Selangor|MY|3.22|101.56
Jhang Sadr|Punjab|PK|31.27|72.32
Ha'il|Ha'il Region|SA|27.52|41.69
Bhavnagar|Gujarat|IN|21.76|72.15
Benoni|Gauteng|ZA|-26.19|28.32
Vladivostok|Primorye|RU|43.11|131.87
Tuxtla|Chiapas|MX|16.75|-93.12
Kryvyy Rih|Dnipropetrovsk|UA|47.91|33.39
Sanming|Fujian|CN|26.25|117.62
Islamabad|Islamabad|PK|33.72|73.04
Sangli|Maharashtra|IN|16.85|74.56
Jamnagar|Gujarat|IN|22.47|70.07
Lubango|Huila|AO|-14.92|13.49
Pokhara|Gandaki Pradesh|NP|28.27|83.97
Shuangyashan|Heilongjiang|CN|46.68|131.13
Borama|Awdal|SO|9.94|43.18
Pallabi|Dhaka Division|BD|23.82|90.37
Luancheng|Hebei|CN|37.88|114.65
Makhachkala|Dagestan|RU|42.98|47.5
Anyang-si|Gyeonggi-do|KR|37.39|126.93
Huambo|Huambo|AO|-12.78|15.74
Samarkand|Samarqand Region|UZ|39.65|66.96
Mengzi|Yunnan|CN|23.37|103.38
Kagoshima|Kagoshima|JP|31.57|130.55
Mukalla|Muhafazat Hadramaout|YE|14.54|49.12
Rasht|Gilan Province|IR|37.28|49.59
Mar del Plata|Buenos Aires|AR|-38|-57.56
Essen|North Rhine-Westphalia|DE|51.46|7.01
Al Mahallah al Kubra|Gharbia|EG|30.97|31.17
Malaga|Andalusia|ES|36.72|-4.42
Shekhupura|Punjab|PK|31.71|73.99
Yingkou|Liaoning|CN|40.66|122.23
Zhangzhou|Fujian|CN|24.51|117.66
Reynosa|Tamaulipas|MX|26.08|-98.28
Thuan An|Ho Chi Minh City (HCMC)|VN|10.92|106.71
Dortmund|North Rhine-Westphalia|DE|51.51|7.47
Suginami|Ibaraki|JP|36.2|140.28
Baltimore|MD|US|39.29|-76.61
Itabashi|Tokyo|JP|35.75|139.71
New Kingston|Saint Andrew Parish|JM|18.01|-76.78
Pelentong|Johor|MY|1.52|103.82
Cimahi|West Java|ID|-6.87|107.54
Londrina|Parana|BR|-23.31|-51.16
Bucaramanga|Santander Department|CO|7.12|-73.12
Genoa|Liguria|IT|44.4|8.94
Hachioji|Tokyo|JP|35.66|139.32
Malacca|Melaka|MY|2.2|102.24
Nha Trang|Khanh Hoa|VN|12.25|109.19
Kerman|Kerman|IR|30.28|57.08
Orumiyeh|West Azerbaijan|IR|37.55|45.08
Bahcelievler|Istanbul|TR|41|28.86
Tanta|Gharbia|EG|30.79|31
Jammu|Jammu and Kashmir|IN|32.74|74.86
Iskandar Puteri|Johor|MY|1.39|103.62
Calamba|Calabarzon|PH|14.21|121.17
Tlalpan|Mexico City|MX|19.3|-99.16
Herat|Herat|AF|34.35|62.2
Dongsheng|Inner Mongolia|CN|39.82|109.98
Gujrat|Punjab|PK|32.57|74.08
Tomsk|Tomsk Oblast|RU|56.5|84.98
UEmraniye|Istanbul|TR|41.02|29.12
Shihezi|Xinjiang|CN|44.3|86.04
South Boston|MA|US|42.33|-71.05
Nakuru|Nakuru County|KE|-0.31|36.07
Hamilton|Ontario|CA|43.25|-79.85
Irbid|Irbid|JO|32.56|35.85
Manchester|England|GB|53.48|-2.24
Kota Bharu|Kelantan|MY|6.12|102.24
Surrey|British Columbia|CA|49.11|-122.83
Meknes|Fes-Meknes|MA|33.89|-5.55
Puente Alto|Santiago Metropolitan|CL|-33.61|-70.58
Nyala|Southern Darfur|SD|12.05|24.88
Xinmin|Liaoning|CN|41.99|122.83
Dresden|Saxony|DE|51.05|13.74
Orenburg|Orenburg Oblast|RU|51.77|55.1
Albuquerque|NM|US|35.08|-106.65
Bokaro|Jharkhand|IN|23.67|86.15
Asmara|Maekel|ER|15.34|38.93
Sukkur|Sindh|PK|27.7|68.86
Milwaukee|WI|US|43.04|-87.91
Cho Lon|Ho Chi Minh City (HCMC)|VN|10.75|106.66
Wenchang|Hainan|CN|19.55|110.8
Ile-Ife|Osun State|NG|7.48|4.56
Gombe|Gombe State|NG|10.29|11.17
Hamhung|South Hamgyong|KP|39.92|127.54
Kemerovo|Kuzbass|RU|55.35|86.1
Nasiriyah|Dhi Qar|IQ|31.06|46.26
Bloemfontein|Free State|ZA|-29.12|26.21
Sheffield|England|GB|53.38|-1.47
Santiago de Cuba|Santiago de Cuba Province|CU|20.02|-75.82
Cuautitlan Izcalli|Mexico|MX|19.64|-99.22
Benguela|Benguela|AO|-12.58|13.4
Chuxiong|Yunnan|CN|25.04|101.55
Balbala|Djibouti|DJ|11.56|43.11
Huaihua|Hunan|CN|27.56|110
Sishui|Shandong|CN|35.65|117.28
Muntinlupa|Calabarzon|PH|14.39|121.05
Binh Thanh|Ho Chi Minh City (HCMC)|VN|10.81|106.71
Zahedan|Sistan and Baluchestan|IR|29.5|60.86
Banqiao|Taipei|TW|25.01|121.47
Nanded|Maharashtra|IN|19.16|77.31
Kozhikode|Kerala|IN|11.25|75.78
Ulanqab|Inner Mongolia|CN|40.99|113.13
Cabinda|Cabinda|AO|-5.56|12.19
Ajegunle|Lagos|NG|6.45|3.33
Pristina|Pristina|XK|42.67|21.17
Ogbia|Bayelsa State|NG|4.69|6.32
Jiamusi|Heilongjiang|CN|46.8|130.31
Korla|Xinjiang|CN|41.76|86.15
Kolhapur|Maharashtra|IN|16.7|74.23
Porto Velho|Rondonia|BR|-8.76|-63.9
San Miguel de Tucuman|Tucuman|AR|-26.82|-65.21
Kuantan|Pahang|MY|3.81|103.33
Sevastopol|Sevastopol City|UA|44.61|33.52
Nellore|Andhra Pradesh|IN|14.45|79.99
Mirpur Model Thana|Dhaka Division|BD|23.81|90.36
Bremen|Bremen|DE|53.08|8.81
Wanning|Hainan|CN|18.8|110.38
Owerri|Imo State|NG|5.48|7.03
Kota Kuala Muda|Kedah|MY|5.59|100.37
Sungai Petani|Kedah|MY|5.65|100.49
Xinzhou|Shanxi|CN|38.41|112.73
Koto|Kumamoto|JP|32.78|130.75
Kalaburagi|Karnataka|IN|17.34|76.84
Tucson|AZ|US|32.22|-110.93
Selayang Baru Utara|Selangor|MY|3.25|101.67
Vilnius|Vilnius|LT|54.69|25.28
Ajmer|Rajasthan|IN|26.45|74.64
Pingdu|Shandong|CN|36.78|119.95
Fresno|CA|US|36.75|-119.77
Mbeya|Mbeya|TZ|-8.9|33.45
Juiz de Fora|Minas Gerais|BR|-21.76|-43.35
Calabar|Cross River State|NG|4.96|8.33
Oujda|Oriental|MA|34.68|-1.91
Novokuznetsk|Kuzbass|RU|53.76|87.14
Ryazan'|Ryazan Oblast|RU|54.63|39.7
Ji'an|Jiangxi|CN|27.12|114.98
Sahiwal|Punjab|PK|31.97|72.33
Mersin|Mersin|TR|36.81|34.64
Niluefer|Bursa Province|TR|40.21|28.92
Leeds|England|GB|53.8|-1.55
Poznan|Greater Poland|PL|52.41|16.93
Aqsu|Xinjiang|CN|41.18|80.28
Ebute Ikorodu|Lagos|NG|6.6|3.49
Ananindeua|Para|BR|-1.37|-48.37
Tanggu|Tianjin|CN|39.02|117.65
Pasir Gudang|Johor|MY|1.46|103.91
Astrakhan|Astrakhan Oblast|RU|46.35|48.04
Okara|Punjab|PK|30.81|73.45
Nansana|Central Region|UG|0.36|32.53
Kimhae|Gyeongsangnam-do|KR|35.23|128.88
Ar Raqqah|Raqqa|SY|35.95|39.01
Quebec|Quebec|CA|46.81|-71.21
Cuauhtemoc|Mexico City|MX|19.45|-99.15
Shangluo|Shaanxi|CN|33.87|109.93
Himeji|Hyogo|JP|34.82|134.7
Ibague|Tolima Department|CO|4.44|-75.2
Antwerp|Flanders|BE|51.22|4.4
Assiut|Asyut|EG|27.18|31.18
Hamadan|Hamadan Province|IR|34.8|48.51
Qionghai|Hainan|CN|19.24|110.46
Aparecida de Goiania|Goias|BR|-16.82|-49.24
Cangzhou|Hebei|CN|38.31|116.85
Mohammadpur|Rajshahi Division|BD|24.9|88.53
Surakarta|Central Java|ID|-7.56|110.83
Yuanping|Shanxi|CN|38.72|112.76
San Salvador|San Salvador Department|SV|13.69|-89.19
Beihai|Guangxi|CN|21.48|109.12
Van|Van|TR|38.49|43.38
Sacramento|CA|US|38.58|-121.49
Thu GJuc|Ho Chi Minh City (HCMC)|VN|10.85|106.77
UEskuedar|Istanbul|TR|41.02|29.01
Penza|Penza Oblast|RU|53.2|45.01
Mazar-e Sharif|Balkh|AF|36.71|67.11
Kandahar|Kandahar|AF|31.61|65.71
Hengshui|Hebei|CN|37.74|115.68
Dehradun|Uttarakhand|IN|30.32|78.03
Erode|Tamil Nadu|IN|11.34|77.73
Lyon|Auvergne-Rhone-Alpes|FR|45.75|4.85
Salta|Salta|AR|-24.81|-65.42
Serra|Espirito Santo|BR|-20.13|-40.31
Esenler|Istanbul|TR|41.04|28.88
Daxing'anling|Heilongjiang|CN|52.33|124.71
Qui Nhon|Gia Lai|VN|13.78|109.22
Al Fayyum|Faiyum|EG|29.31|30.84
Durgapur|West Bengal|IN|23.52|87.31
Utsunomiya|Tochigi|JP|36.57|139.88
Victoria de Durango|Durango|MX|24.02|-104.66
Belford Roxo|Rio de Janeiro|BR|-22.76|-43.4
Lisbon|Lisbon|PT|38.73|-9.15
Rahim Yar Khan|Punjab|PK|28.42|70.3
Ulhasnagar|Maharashtra|IN|19.22|73.15
Guangyuan|Sichuan|CN|32.44|105.82
Loni|Uttar Pradesh|IN|28.75|77.29
Siliguri|West Bengal|IN|26.71|88.43
Nuremberg|Bavaria|DE|49.45|11.08
Niteroi|Rio de Janeiro|BR|-22.88|-43.1
Ujjain|Madhya Pradesh|IN|23.18|75.78
Hannover|Lower Saxony|DE|52.37|9.73
Edinburgh|Scotland|GB|55.95|-3.2
Macapa|Amapa|BR|0.04|-51.07
Xianning|Hubei|CN|29.84|114.32
Toulouse|Occitanie|FR|43.6|1.44
Thembisa|Gauteng|ZA|-26|28.23
Carrefour|Ouest|HT|18.53|-72.4
Matsuyama|Ehime|JP|33.84|132.77
Bilimora|Gujarat|IN|20.77|72.96
Kasur|Punjab|PK|31.12|74.45
Atlanta|GA|US|33.75|-84.39
Heroica Matamoros|Tamaulipas|MX|25.88|-97.5
Makati City|National Capital Region|PH|14.55|121.03
Buda|Budapest|HU|47.5|19.03
Tonghua|Jilin|CN|41.72|125.93
Mianzhu, Deyang, Sichuan|Sichuan|CN|31.34|104.22
Naberezhnyye Chelny|Tatarstan Republic|RU|55.74|52.42
Lipetsk|Lipetsk Oblast|RU|52.59|39.55
Kikwit|Kwilu|CD|-5.04|18.82
Florianopolis|Santa Catarina|BR|-27.6|-48.55
Banan|Chongqing|CN|29.38|106.54
Newcastle|New South Wales|AU|-32.93|151.78
Tuen Mun|Tuen Mun|HK|22.39|113.97
Zhangye|Gansu|CN|38.93|100.45
Kirov|Kirov Oblast|RU|58.6|49.66
Kashgar|Xinjiang|CN|39.47|75.99
Mukim Pulai|Johor|MY|1.53|103.67
Najran|Najran Region|SA|17.49|44.13
Karol Bagh|Delhi|IN|28.65|77.19
Zhoukou|Henan|CN|33.63|114.63
Leipzig|Saxony|DE|51.34|12.37
Pingliang|Gansu|CN|35.54|106.69
Kalininskiy|St.-Petersburg|RU|60|30.39
Duisburg|North Rhine-Westphalia|DE|51.43|6.77
Asansol|West Bengal|IN|23.68|86.98
Arak|Markazi|IR|34.09|49.7
Maipu|Santiago Metropolitan|CL|-33.51|-70.77
Homyel'|Homyel' Voblasc'|BY|52.43|30.98
Aktobe|Aktobe|KZ|50.28|57.21
Kota Kinabalu|Sabah|MY|5.97|116.07
Talatona|Luanda|AO|-8.92|13.19
Kampung Larkin Lama|Johor|MY|1.5|103.74
Kota Damansara|Selangor|MY|3.15|101.58
Jalalpur Pirwala|Punjab|PK|29.51|71.22
Mangaluru|Karnataka|IN|12.92|74.86
Zhucheng|Shandong|CN|35.99|119.4
Santa Marta|Magdalena Department|CO|11.24|-74.19
Matsudo|Chiba|JP|35.78|139.9
Hathazari|Chittagong|BD|22.51|91.81
Lapu-Lapu City|Central Visayas|PH|10.31|123.95
Karagandy|Karaganda|KZ|49.8|73.1
Loudi|Hunan|CN|27.73|111.99
Liverpool|England|GB|53.41|-2.98
Ichikawa|Chiba|JP|35.73|139.91
Sha Tin|Sha Tin|HK|22.38|114.18
Dera Ghazi Khan|Punjab|PK|30.05|70.64
Hecun|Hebei|CN|36.53|114.11
Higashiosaka|Osaka|JP|34.67|135.58
Pindi Bhattian|Punjab|PK|31.9|73.27
Cheboksary|Chuvash Republic|RU|56.13|47.25
Pohang|Gyeongsangbuk-do|KR|36.03|129.36
Shanwei|Guangdong|CN|22.78|115.35
Monteria|Cordoba|CO|8.75|-75.88
Ruiru|Kiambu County|KE|-1.15|36.96
Valledupar|Cesar Department|CO|10.47|-73.25
Belagavi|Karnataka|IN|15.85|74.5
Ajman|Ajman|AE|25.4|55.48
Jianshui|Yunnan|CN|24.28|101.22
Sancaktepe|Istanbul|TR|41|29.23
Port Sudan|Red Sea|SD|19.62|37.22
Toluca|Mexico|MX|19.29|-99.65
Ciudad Lopez Mateos|Mexico|MX|19.56|-99.26
Al Khusus|Qalyubia|EG|30.15|31.32
Jeju City|Jeju-do|KR|33.51|126.52
Gdansk|Pomerania|PL|54.35|18.65
Miami|FL|US|25.77|-80.19
Omaha|NE|US|41.26|-95.94
Nishinomiya|Hyogo|JP|34.72|135.33
Masina|Kinshasa|CD|-4.38|15.39
Saharanpur|Uttar Pradesh|IN|29.97|77.55
Vellore|Tamil Nadu|IN|12.92|79.13
Donghe|Inner Mongolia|CN|40.57|110.02
Kurashiki|Okayama|JP|34.58|133.77
Campos dos Goytacazes|Rio de Janeiro|BR|-21.75|-41.33
Angeles City|Central Luzon|PH|15.15|120.58
Bhatpara|West Bengal|IN|22.87|88.4
Jijiga|Somali|ET|9.35|42.8
Tula|Tula Oblast|RU|54.2|37.62
Najaf|Najaf|IQ|32.03|44.35
Raleigh|NC|US|35.77|-78.64
Imus|Calabarzon|PH|14.43|120.94
Xichang|Sichuan|CN|27.9|102.26
Malegaon|Maharashtra|IN|20.55|74.53
Zaoyang|Hubei|CN|32.13|112.75
Sao Jose do Rio Preto|Sao Paulo|BR|-20.82|-49.38
Caxias do Sul|Rio Grande do Sul|BR|-29.17|-51.18
Karabaglar|Izmir Province|TR|38.38|27.13
Okene|Kogi State|NG|7.55|6.24
Uijeongbu-si|Gyeonggi-do|KR|37.74|127.05
Bristol|England|GB|51.46|-2.6
East London|Eastern Cape|ZA|-33.02|27.91
Chengguan Qu|Tibet|CN|29.64|91.04
Yazd|Yazd Province|IR|31.9|54.37
Hargeysa|Woqooyi Galbeed|SO|9.56|44.06
Oita|Oita|JP|33.23|131.6
Jincheng|Shanxi|CN|35.5|112.83
Hongjiang|Hunan|CN|27.11|110
Modinagar|Uttar Pradesh|IN|28.83|77.57
Taoyuan|Taiwan|TW|24.99|121.3
Eldoret|Uasin Gishu County|KE|0.52|35.27
Kansas City|MO|US|39.1|-94.58
Yan'an|Shaanxi|CN|36.6|109.49
Kaliningrad|Kaliningrad Oblast|RU|54.71|20.51
Skopje|Grad Skopje|MK|42|21.43
Kupang|East Nusa Tenggara|ID|-10.17|123.61
Vereeniging|Gauteng|ZA|-26.67|27.93
The Hague|South Holland|NL|52.08|4.3
Long Beach|CA|US|33.77|-118.19
Gaya|Bihar|IN|24.8|85
Iloilo|Western Visayas|PH|10.7|122.56
Shouguang|Shandong|CN|36.88|118.74
Jingdezhen|Jiangxi|CN|29.29|117.21
Murcia|Murcia|ES|37.99|-1.13
Mesa|AZ|US|33.42|-111.82
Halifax|Nova Scotia|CA|44.64|-63.58
Morogoro|Morogoro|TZ|-6.82|37.66
Marikina City|National Capital Region|PH|14.65|121.11
Kenitra|Rabat-Sale-Kenitra|MA|34.26|-6.58
Seeb|Muscat|OM|23.67|58.19
Cilegon|Banten|ID|-6.01|106.05
Mykolayiv|Mykolaiv|UA|46.98|31.99
Fukuyama|Hiroshima|JP|34.48|133.37
Staten Island|NY|US|40.56|-74.14
Nanping|Fujian|CN|26.64|118.17
Pereira|Risaralda Department|CO|4.81|-75.69
Ciudad Apodaca|Nuevo Leon|MX|25.78|-100.19
Sao Joao de Meriti|Rio de Janeiro|BR|-22.8|-43.37
Ambattur|Tamil Nadu|IN|13.1|80.16
Kanazawa|Ishikawa|JP|36.6|136.62
Gonder|Amhara|ET|12.6|37.47
Mandaluyong City|National Capital Region|PH|14.58|121.04
Mixco|Guatemala|GT|14.63|-90.61
Paju|Gyeonggi-do|KR|37.76|126.77
Longshan|Jilin|CN|42.89|125.14
Ikare|Ondo State|NG|7.53|5.75
Nova Vida|Luanda|AO|-8.91|13.22
Vung Tau|Ho Chi Minh City (HCMC)|VN|10.35|107.08
Maracay|Aragua|VE|10.25|-67.59
Tamale|Northern|GH|9.4|-0.84
Heyuan|Guangdong|CN|23.73|114.68
Di An|Ho Chi Minh City (HCMC)|VN|10.91|106.77
Kira|Central Region|UG|0.4|32.63
Esna|Qena|EG|25.29|32.55
Huangshan|Anhui|CN|29.71|118.31
Hamah|Hama|SY|35.13|36.76
Jalgaon|Maharashtra|IN|21|75.57
Kurnool|Andhra Pradesh|IN|15.83|78.04
Yola|Adamawa|NG|9.21|12.48
Tieling|Liaoning|CN|42.29|123.84
Rach Gia|An Giang|VN|10.01|105.08
Amagasaki|Hyogo|JP|34.72|135.42
Manado|North Sulawesi|ID|1.48|124.85
Santo Domingo de los Colorados|Santo Domingo de los Tsachilas|EC|-0.25|-79.18
Tartus|Tartus|SY|34.89|35.89
Mek'ele|Tigray|ET|13.5|39.48
Nazret|Oromiya|ET|8.55|39.27
Colorado Springs|CO|US|38.83|-104.82
Huancayo|Junin|PE|-12.07|-75.21
Al Hillah|Babil|IQ|32.46|44.42
Mbandaka|Equateur|CD|0.05|18.26
Malanje|Malanje|AO|-9.54|16.34
Namp'o|Nampo|KP|38.74|125.41
Ciudad General Escobedo|Nuevo Leon|MX|25.8|-100.32
Bacolod City|Western Visayas|PH|10.67|122.95
Virginia Beach|VA|US|36.85|-75.98
Wafangdian|Liaoning|CN|39.62|122.01
Mansilingan|Western Visayas|PH|10.63|122.98
Kahama|Shinyanga|TZ|-3.83|32.6
Hsinchu|Taiwan|TW|24.8|120.97
Katsushika|Tokyo|JP|35.73|139.85
Bornova|Izmir Province|TR|38.48|27.24
Ramgundam|Telangana|IN|18.8|79.45
Batman|Batman|TR|37.89|41.13
Yongji|Shanxi|CN|34.87|110.44
Lishui|Zhejiang|CN|28.46|119.91
Udaipur|Rajasthan|IN|24.59|73.71
Warder|Somali|ET|6.97|45.34
Wenshan City|Yunnan|CN|23.36|104.25
Eslamshahr|Tehran|IR|35.55|51.24
Juba|Central Equatoria|SS|4.85|31.58
Muratpasa|Antalya|TR|36.89|30.76
Bac Giang|Bac Ninh|VN|21.27|106.19
Sanliurfa|Sanliurfa|TR|37.17|38.79
Kursk|Kursk Oblast|RU|51.73|36.18
Maheshtala|West Bengal|IN|22.51|88.25
Nam GJinh|Ninh Binh|VN|20.43|106.18
Constantine|Constantine|DZ|36.37|6.61
Patiala|Punjab|IN|30.34|76.39
Boksburg|Gauteng|ZA|-26.21|28.26
Basuo|Hainan|CN|19.1|108.67
Campina Grande|Paraiba|BR|-7.23|-35.88
Ensenada|Baja California|MX|31.87|-116.6
Elazig|Elazig|TR|38.67|39.22
Jundiai|Sao Paulo|BR|-23.19|-46.88
Xochimilco|Mexico City|MX|19.25|-99.1
Shyamnagar|West Bengal|IN|22.83|88.37
Dasmarinas|Calabarzon|PH|14.33|120.94
Zhangjiajie|Hunan|CN|29.13|110.48
Mataram|West Nusa Tenggara|ID|-8.58|116.12
Korhogo|Savanes District|CI|9.46|-5.63
Piracicaba|Sao Paulo|BR|-22.73|-47.65
Fujisawa|Kanagawa|JP|35.35|139.48
Bissau|Bissau|GW|11.86|-15.6
Zhongxiang|Hubei|CN|31.17|112.58
Sandakan|Sabah|MY|5.84|118.12
Mawlamyine|Mon|MM|16.49|97.63
Laval|Quebec|CA|45.57|-73.69
Palma|Balearic Islands|ES|39.57|2.65
Montes Claros|Minas Gerais|BR|-16.73|-43.86
Sunch'on|South Pyongan|KP|39.43|125.93
Sultangazi|Istanbul|TR|41.11|28.87
Uyo|Akwa Ibom State|NG|5.05|7.93
Bei'an|Heilongjiang|CN|48.27|126.6
Davangere|Karnataka|IN|14.47|75.93
Macheng|Hubei|CN|31.18|115.02
Ado-Ekiti|Ekiti State|NG|7.62|5.22
Manizales|Caldas Department|CO|5.07|-75.51
Masan|Gwangju|KR|35.13|126.83
Buon Ma Thuot|Dak Lak|VN|12.67|108.04
Stavropol|Stavropol Kray|RU|45.03|41.96
Shuozhou|Shanxi|CN|39.32|112.42
Kashiwa|Chiba|JP|35.86|139.98
Ogbomoso|Oyo State|NG|8.13|4.24
Tel Aviv|Tel Aviv|IL|32.08|34.78
Buenaventura|Valle del Cauca Department|CO|3.58|-77
Welkom|Free State|ZA|-27.98|26.74
Sham Shui Po|Sham Shui Po District|HK|22.33|114.16
Machida|Tokyo|JP|35.54|139.45
Venustiano Carranza|Mexico City|MX|19.44|-99.1
Zagazig|Sharqia|EG|30.59|31.5
Vinnytsya|Vinnytsia|UA|49.23|28.47
Ismailia|Ismailia|EG|30.6|32.27
Ningde|Fujian|CN|26.66|119.52
Akola|Maharashtra|IN|20.71|77
Kima Kieza|Luanda|AO|-8.83|13.3
Cusco|Cuzco Department|PE|-13.53|-71.97
Jiuquan|Gansu|CN|39.74|98.52
Veracruz|Veracruz|MX|19.18|-96.14
East Jerusalem|West Bank|PS|31.78|35.23
Bryansk|Bryansk Oblast|RU|53.27|34.32
Maltepe|Istanbul|TR|40.94|29.16
Sumgayit|Sumqayit|AZ|40.59|49.67
Tando Bago|Sindh|PK|24.79|68.97
Kuala Terengganu|Terengganu|MY|5.33|103.14
Toyota|Aichi|JP|35.08|137.15
Matadi|Bas-Congo|CD|-5.84|13.46
Al Kharj|Riyadh Region|SA|24.16|47.33
Wong Tai Sin|Wong Tai Sin District|HK|22.35|114.18
Minna|Niger State|NG|9.62|6.55
Mandaluyong|National Capital Region|PH|14.58|121.04
Xalapa de Enriquez|Veracruz|MX|19.53|-96.92
Rajpur Sonarpur|West Bengal|IN|22.44|88.43
Bratislava|Bratislava Region|SK|48.15|17.11
Taman Petaling|Kuala Lumpur|MY|3.2|101.65
Shinagawa|Ehime|JP|33.64|133.01
Al Hasakah|Al-Hasakah|SY|36.5|40.75
Luxor|Luxor|EG|25.7|32.64
London|Ontario|CA|42.98|-81.23
Awasa|Sidama Region|ET|7.06|38.48
Chimoio|Manica|MZ|-19.12|33.48
Tando Allahyar|Sindh|PK|25.46|68.72
Daloa|Sassandra-Marahoue|CI|6.88|-6.45
Barra da Tijuca|Rio de Janeiro|BR|-23|-43.37
Dingxi|Gansu|CN|35.57|104.62
Bamenda|North-West|CM|5.96|10.15
Tver|Tver Oblast|RU|56.86|35.9
Thai Nguyen|Thai Nguyen|VN|21.59|105.85
Boa Vista|Roraima|BR|2.82|-60.67
Rio Branco|Acre|BR|-9.97|-67.81
Oakland|CA|US|37.8|-122.27
Christchurch|Canterbury|NZ|-43.53|172.63
Korba|Chhattisgarh|IN|22.35|82.7
Takamatsu|Kagawa|JP|34.33|134.05
Kowloon City|Kowloon City|HK|22.33|114.19
Santos|Sao Paulo|BR|-23.96|-46.33
Tirana|Tirana|AL|41.33|19.82
Petrolina|Pernambuco|BR|-9.4|-40.5
Maua|Sao Paulo|BR|-23.67|-46.46
San Juan|San Juan|PR|18.47|-66.11
Alor Setar|Kedah|MY|6.12|100.36
Tongchuan|Shaanxi|CN|34.9|108.95
Pasay|National Capital Region|PH|14.54|121
Nuevo Laredo|Tamaulipas|MX|27.48|-99.52
Toyama|Toyama|JP|36.7|137.22
Tetouan|Tanger-Tetouan-Al Hoceima|MA|35.58|-5.37
Zuerich|Zurich|CH|47.37|8.55
Beylikduezue|Istanbul|TR|40.98|28.64
Viet Tri|Phu Tho|VN|21.32|105.4
Azcapotzalco|Mexico City|MX|19.49|-99.19
Tampa|FL|US|27.95|-82.46
Bunamwaya|Central Region|UG|0.25|32.56
Magnitogorsk|Chelyabinsk|RU|53.4|59.01
Tulsa|OK|US|36.15|-95.99
Jhansi|Uttar Pradesh|IN|25.46|78.58
Tseung Kwan O|Sai Kung District|HK|22.33|114.25
Ciudad Bolivar|Bolivar|VE|8.12|-63.55
Kampung Kangkar Teberau|Johor|MY|1.53|103.75
Koumassi|Abidjan Autonomous District|CI|5.3|-3.97
San Nicolas de los Garza|Nuevo Leon|MX|25.74|-100.3
Guyuan|Ningxia|CN|36.01|106.28
Wandsbek|Hamburg|DE|53.58|10.08
Minneapolis|MN|US|44.98|-93.26
Jayapura|Papua|ID|-2.53|140.72
Thoothukudi|Tamil Nadu|IN|8.77|78.13
Ardabil|Ardabil Province|IR|38.25|48.29
Ballari|Karnataka|IN|15.14|76.92
Chaoyang|Liaoning|CN|41.57|120.46
Gaza|Gaza Strip|PS|31.5|34.47
Maringa|Parana|BR|-23.43|-51.94
Yokosuka|Kanagawa|JP|35.28|139.67
Kom Ombo|Aswan|EG|24.48|32.95
Saltivka|Kharkiv|UA|50.02|36.35
Nagasaki|Nagasaki|JP|32.75|129.88
Gujangbagh|Xinjiang|CN|37.11|79.93
Tonala|Jalisco|MX|20.62|-103.24
Zhijiang|Hubei|CN|30.42|111.75
Panama City|Panama|PA|8.99|-79.52
Uvira|South Kivu|CD|-3.4|29.14
Hirakata|Osaka|JP|34.81|135.65
Ivanovo|Ivanovo Oblast|RU|57|40.97
Cumana|Sucre|VE|10.46|-64.18
Newcastle|KwaZulu-Natal|ZA|-27.76|29.93
Gumi|Gyeongsangbuk-do|KR|36.11|128.34
Brno|South Moravian|CZ|49.2|16.61
Jixi|Heilongjiang|CN|45.29|130.96
Diadema|Sao Paulo|BR|-23.69|-46.62
Kuching|Sarawak|MY|1.55|110.33
Gifu|Gifu|JP|35.42|136.76
Caruaru|Pernambuco|BR|-8.28|-35.98
Tongling|Anhui|CN|30.95|117.78
Tarlac City|Central Luzon|PH|15.48|120.6
Toyonaka|Osaka|JP|34.78|135.47
Kassala|Kassala|SD|15.45|36.4
Miyazaki|Miyazaki|JP|31.92|131.42
Lekki|Lagos|NG|6.45|3.48
Antofagasta|Antofagasta|CL|-23.65|-70.4
Wah Cantt|Punjab|PK|33.77|72.75
Bhagalpur|Bihar|IN|25.24|86.97
Agartala|Tripura|IN|23.84|91.28
Dayrah|Dubai|AE|25.27|55.3
West Jerusalem|Jerusalem|IL|31.78|35.22
Bida|Niger State|NG|9.08|6.01
Bunia|Ituri|CD|1.56|30.25
Antakya|Hatay|TR|36.21|36.16
Quan Muoi|Ho Chi Minh City (HCMC)|VN|10.77|106.67
Sunshine Coast|Queensland|AU|-26.66|153.08
Kisumu|Kisumu County|KE|-0.1|34.76
Luhansk|Luhansk|UA|48.57|39.31
Bengkulu|Bengkulu|ID|-3.8|102.27
Barinas|Barinas|VE|8.62|-70.23
Hancheng|Shaanxi|CN|35.46|110.43
Vitoria da Conquista|Bahia|BR|-14.87|-40.84
Wichita|KS|US|37.69|-97.34
Al Hoceima|Tanger-Tetouan-Al Hoceima|MA|35.25|-3.94
Szczecin|West Pomerania|PL|53.43|14.55
Delmas|Ouest|HT|18.54|-72.3
Liaozhong|Liaoning|CN|41.51|122.72
Vila Velha|Espirito Santo|BR|-20.33|-40.29
Bologna|Emilia-Romagna|IT|44.49|11.34
Sejong|Sejong-si|KR|36.59|127.29
Cazenga|Luanda|AO|-8.84|13.28
Samsun|Samsun|TR|41.28|36.34
Tallinn|Harjumaa|EE|59.44|24.75
Tanga|Tanga|TZ|-5.07|39.1
El Obeid|North Kordofan|SD|13.18|30.22
Lobito|Benguela|AO|-12.36|13.54
Saurimo|Lunda Sul|AO|-9.66|20.39
Bauru|Sao Paulo|BR|-22.31|-49.06
Bello|Antioquia|CO|6.34|-75.56
Pasto|Narino|CO|1.21|-77.28
Gaomi|Shandong|CN|36.38|119.75
Santa Fe|Santa Fe|AR|-31.65|-60.71
San-Pedro|Bas-Sassandra District|CI|4.75|-6.64
Gauriganj|Uttar Pradesh|IN|26.21|81.69
Makurdi|Benue State|NG|7.73|8.52
Palu|Central Sulawesi|ID|-0.91|119.87
Takoradi|Western|GH|4.9|-1.76
Samut Prakan|Samut Prakan|TH|13.6|100.6
Arlington|TX|US|32.74|-97.11
Khamis Mushait|'Asir Region|SA|18.3|42.73
Ambato|Tungurahua Province|EC|-1.25|-78.62
Carapicuiba|Sao Paulo|BR|-23.52|-46.84
Ojo de Agua|Mexico|MX|19.68|-99.01
Windhoek|Khomas Region|NA|-22.56|17.08
Abomey-Calavi|Atlantique|BJ|6.45|2.36
Bochum|North Rhine-Westphalia|DE|51.48|7.22
Suita|Osaka|JP|34.76|135.52
Benito Juarez|Mexico City|MX|19.37|-99.16
Sector 3|Bucharest|RO|44.42|26.17
Chak Jhumra|Punjab|PK|31.57|73.18
Kahramanmaras|Kahramanmaras|TR|37.58|36.93
Chongzuo|Guangxi|CN|22.38|107.37
Grajau|Sao Paulo|BR|-23.77|-46.67
Okazaki|Aichi|JP|34.95|137.17
Xico|Mexico|MX|19.27|-98.95
Iztacalco|Mexico City|MX|19.4|-99.1
Kakinada|Andhra Pradesh|IN|16.96|82.24
Betim|Minas Gerais|BR|-19.97|-44.2
Las Palmas de Gran Canaria|Canary Islands|ES|28.1|-15.42
Cotabato|Autonomous Region in Muslim Mindanao|PH|7.22|124.25
Bawshar|Muscat|OM|23.58|58.4
Latur|Maharashtra|IN|18.4|76.57
Tanzhou|Guangdong|CN|22.26|113.47
Wellington|Wellington Region|NZ|-41.29|174.78
Mazatlan|Sinaloa|MX|23.22|-106.42
Nizhny Tagil|Sverdlovsk Oblast|RU|57.92|59.97
Irapuato|Guanajuato|MX|20.67|-101.36
Ichinomiya|Aichi|JP|35.3|136.8
Aswan|Aswan|EG|24.09|32.9
Iasi|Iasi County|RO|47.17|27.6
Krugersdorp|Gauteng|ZA|-26.09|27.78
Panihati|West Bengal|IN|22.69|88.37
Shibganj|Rajshahi Division|BD|25|89.32
Caucaia|Ceara|BR|-3.74|-38.65
Iquitos|Loreto|PE|-3.75|-73.25
Toyohashi|Aichi|JP|34.77|137.38
Hechuan|Chongqing|CN|29.99|106.26
Petionville|Ouest|HT|18.51|-72.29
Utrecht|Utrecht|NL|52.09|5.12
Rajamahendravaram|Andhra Pradesh|IN|17.01|81.78
Cariacica|Espirito Santo|BR|-20.26|-40.42
Yogyakarta|Yogyakarta|ID|-7.8|110.36
Dhule|Maharashtra|IN|20.9|74.78
Yanzhou|Shandong|CN|35.55|116.83
Minato|Wakayama|JP|34.22|135.15
Puchong|Selangor|MY|3|101.62
Ondo|Ondo State|NG|7.09|4.84
Pingyin|Shandong|CN|36.28|116.45
Rohtak|Haryana|IN|28.89|76.59
Bhawana|Punjab|PK|31.57|72.65
Rustenburg|North West|ZA|-25.67|27.24
Bakersfield|CA|US|35.37|-119.02
Xuanhua|Hebei|CN|40.61|115.06
Emalahleni|Mpumalanga|ZA|-25.87|29.23
Bafoussam|West|CM|5.48|10.42
Thu Dau Mot|Ho Chi Minh City (HCMC)|VN|10.98|106.65
Takasaki|Gunma|JP|36.33|139.02
Seremban|Negeri Sembilan|MY|2.73|101.94
Miguel Hidalgo|Mexico City|MX|19.43|-99.2
Nagano|Nagano|JP|36.65|138.18
Tawau|Sabah|MY|4.24|117.89
Cardiff|Wales|GB|51.48|-3.18
Dachang|Shanghai|CN|31.31|121.42
GJong GJa|Hanoi|VN|21.01|105.83
Chitungwiza|Harare|ZW|-18.01|31.08
Fenghuang|Hunan|CN|27.94|109.6
Umuahia|Abia State|NG|5.52|7.49
Puerto La Cruz|Anzoategui|VE|10.21|-64.63
Usak|Usak|TR|38.67|29.41
Bharatpur|Bagmati Province|NP|27.68|84.44
Itaquaquecetuba|Sao Paulo|BR|-23.49|-46.35
Natore|Rajshahi Division|BD|24.41|88.99
6th of October City|Giza|EG|29.82|31.05
Leicester|England|GB|52.64|-1.13
Desna|Kyiv City|UA|50.52|30.68
Cascavel|Parana|BR|-24.96|-53.46
Sector 6|Bucharest|RO|44.44|26.02
Canberra|Australian Capital Territory|AU|-35.28|149.13
Avellaneda|Buenos Aires|AR|-34.66|-58.37
Praia Grande|Sao Paulo|BR|-24.01|-46.4
Nara-shi|Nara|JP|34.69|135.8
Florence|Tuscany|IT|43.78|11.25
Ahilyanagar|Maharashtra|IN|19.09|74.74
Kollam|Kerala|IN|8.88|76.58
Huanggang|Hubei|CN|30.45|114.87
Bradford|England|GB|53.79|-1.75
Sukabumi|West Java|ID|-6.92|106.93
Bilaspur|Chhattisgarh|IN|22.08|82.16
Malabon|National Capital Region|PH|14.67|120.94
Franca|Sao Paulo|BR|-20.54|-47.4
Cleveland|OH|US|41.5|-81.7
Iseyin|Oyo State|NG|7.97|3.6
Etobicoke|Ontario|CA|43.64|-79.57
Yenagoa|Bayelsa State|NG|4.93|6.27
Gboko|Benue State|NG|7.32|9
Samba|Luanda|AO|-8.88|13.2
Olinda|Pernambuco|BR|-8.01|-34.86
Pyeongtaek|Gyeonggi-do|KR|36.99|127.09
Petare|Miranda|VE|10.48|-66.81
Ben Cat|Ho Chi Minh City (HCMC)|VN|11.15|106.6
Anqiu|Shandong|CN|36.43|119.19
Alanya|Antalya|TR|36.54|32
Larkana|Sindh|PK|27.56|68.21
Al Qadarif|Al Qadarif|SD|14.03|35.38
Hrodna|Grodnenskaya|BY|53.68|23.83
Cibinong|West Java|ID|-6.48|106.85
Nawabshah|Sindh|PK|26.24|68.4
New Orleans|LA|US|29.95|-90.08
Keelung|Taiwan|TW|25.13|121.74
Malmoe|Skane|SE|55.61|13
Jizhou|Hebei|CN|37.55|115.57
Manukau City|Auckland|NZ|-36.99|174.88
Maradi|Maradi Region|NE|13.5|7.1
Burewala|Punjab|PK|30.17|72.65
Atasehir|Istanbul|TR|40.98|29.12
Blumenau|Santa Catarina|BR|-26.92|-49.07
Nanqiao|Shanghai|CN|30.92|121.45
Mingora|Khyber Pakhtunkhwa|PK|34.78|72.36
Santarem|Para|BR|-2.44|-54.71
Wuppertal|North Rhine-Westphalia|DE|51.26|7.15
Ulan-Ude|Buryatiya Republic|RU|51.83|107.6
Huocheng|Xinjiang|CN|44.05|80.87
Ijebu Ode|Ogun State|NG|6.82|3.92
Maseru|Maseru District|LS|-29.32|27.48
Bhilwara|Rajasthan|IN|25.35|74.64
Aurora|CO|US|39.73|-104.83
Vitebsk|Vitebsk|BY|55.19|30.2
Sultanbeyli|Istanbul|TR|40.96|29.27
Taraz|Zhambyl|KZ|42.9|71.37
Yangsan|Gyeongsangnam-do|KR|35.34|129.03
Dniprovskyi|Kyiv City|UA|50.45|30.6
San Jose del Monte|Central Luzon|PH|14.81|121.05
Abu al-Kahsib|Basra|IQ|30.44|47.88
Gwangmyeong|Gyeonggi-do|KR|37.48|126.87
Zanjan|Zanjan|IR|36.68|48.5
Neiva|Huila Department|CO|2.93|-75.28
Iwaki|Fukushima|JP|37.05|140.88
Vladimir|Vladimir Oblast|RU|56.14|40.4
Tete|Tete|MZ|-16.16|33.59
Bacoor|Calabarzon|PH|14.46|120.94
Uberaba|Minas Gerais|BR|-19.75|-47.93
Wakayama|Wakayama|JP|34.23|135.17
Brahmapur|Odisha|IN|19.31|84.79
Fengshan|Takao|TW|22.63|120.36
Fatih|Istanbul|TR|41.02|28.94
Misratah|Misratah|LY|32.38|15.09
Cuito|Bie|AO|-12.38|16.93
Kyzylorda|Kyzylorda|KZ|44.85|65.51
Sinjhoro|Sindh|PK|26.03|68.81
Kawagoe|Saitama|JP|35.91|139.49
Takatsuki|Osaka|JP|34.85|135.62
Muzaffarpur|Bihar|IN|26.12|85.39
Tapachula|Chiapas|MX|14.91|-92.26
Lhoka|Tibet|CN|29.24|91.77
Villahermosa|Tabasco|MX|17.99|-92.94
Setapak|Selangor|MY|3.21|101.73
Mahilyow|Mogilev|BY|53.91|30.34
Bandar Abbas|Hormozgan|IR|27.19|56.28
Pravyi Bereh|Donetsk|UA|47.11|37.59
Yunusobod|Tashkent|UZ|41.37|69.28
Ras Al Khaimah|Ras Al Khaimah|AE|25.79|55.94
Cabimas|Zulia|VE|10.4|-71.45
Kendari|Southeast Sulawesi|ID|-3.98|122.52
Honolulu|HI|US|21.31|-157.86
Anaheim|CA|US|33.84|-117.91
Tarsus|Mersin|TR|36.92|34.89
Pengze|Jiangxi|CN|29.9|116.55
Bahir Dar|Amhara|ET|11.59|37.39
Punasa|Madhya Pradesh|IN|22.24|76.39
Al Mahmudiyah|Baghdad|IQ|33.06|44.37
Diepsloot|Gauteng|ZA|-25.93|28.01
Xilinhot|Inner Mongolia|CN|43.94|116.07
Sao Jose dos Pinhais|Parana|BR|-25.53|-49.21
Quelimane|Zambezia Province|MZ|-17.88|36.89
Arkhangel'sk|Arkhangelskaya|RU|64.55|40.55
Muzaffarnagar|Uttar Pradesh|IN|29.47|77.7
Hulunbuir|Inner Mongolia|CN|49.21|119.76
Dumai|Riau|ID|1.67|101.44
Shinjuku|Tokyo|JP|35.69|139.71
Sikasso|Sikasso|ML|11.32|-5.67
Sanandaj|Kurdistan Province|IR|35.31|47
Chita|Zabaykalskiy (Transbaikal) Kray|RU|52.04|113.49
San Pedro|Calabarzon|PH|14.36|121.05
Alicante|Valencia|ES|38.35|-0.48
Bimbo|Ombella-M'Poko|CF|4.26|18.42
Kalemyo|Sagaing Region|MM|23.19|94.06
Belfast|Northern Ireland|GB|54.6|-5.93
Long Bien|Hanoi|VN|21.03|105.9
Camagueey|Camaguey|CU|21.38|-77.92
Bilbao|Basque Country|ES|43.26|-2.93
Ambon|Maluku|ID|-3.7|128.18
Brest|Brest|BY|52.11|23.72
Ribeirao das Neves|Minas Gerais|BR|-19.77|-44.09
Chifeng|Inner Mongolia|CN|42.27|118.96
Central Coast|New South Wales|AU|-33.43|151.37
Corrientes|Corrientes|AR|-27.47|-58.83
Hungnam|South Hamgyong|KP|39.84|127.63
Avadi|Tamil Nadu|IN|13.11|80.11
Yunlong|Jiangsu|CN|34.25|117.25
Koshigaya|Saitama|JP|35.89|139.79
Coventry|England|GB|52.41|-1.51
Belgorod|Belgorod Oblast|RU|50.6|36.58
Toamasina|Atsinanana|MG|-18.15|49.4
Logan City|Queensland|AU|-27.64|153.11
Otsu|Shiga|JP|35|135.87
Kosti|White Nile|SD|13.16|32.66
Qitaihe|Heilongjiang|CN|45.77|131
Doha|Baladiyat ad Dawhah|QA|25.29|51.53
Kadapa|Andhra Pradesh|IN|14.48|78.82
Nakano|Tokyo|JP|35.7|139.67
Cirebon|West Java|ID|-6.71|108.56
Turmero|Aragua|VE|10.23|-67.47
Tokorozawa|Saitama|JP|35.8|139.47
Cabanatuan City|Central Luzon|PH|15.49|120.97
Pizhou|Jiangsu|CN|34.31|117.95
Darnytsya|Kyiv City|UA|50.42|30.7
Dire Dawa|Dire Dawa|ET|9.59|41.87
Annaba|Annaba|DZ|36.9|7.77
Nice|Provence-Alpes-Cote d'Azur|FR|43.7|7.27
Iligan|Northern Mindanao|PH|8.23|124.24
Soledad|Atlantico|CO|10.92|-74.76
Temara|Rabat-Sale-Kenitra|MA|33.93|-6.91
Paulista|Pernambuco|BR|-7.94|-34.87
Obalende|Lagos|NG|6.45|3.42
Kukatpally|Telangana|IN|17.48|78.41
Laixi|Shandong|CN|36.86|120.53
Dihok|Duhok|IQ|36.87|42.99
Kaluga|Kaluga Oblast|RU|54.53|36.27
Bac Tu Liem|Hanoi|VN|21.07|105.75
Celaya|Guanajuato|MX|20.52|-100.81
Serekunda|Banjul|GM|13.44|-16.68
Kafrul|Dhaka Division|BD|23.79|90.37
Karsiyaka|Izmir Province|TR|38.46|27.11
Hada'iq al Qubbah|Cairo|EG|30.09|31.28
Makiyivka|Donetsk|UA|48.05|37.93
West Raleigh|NC|US|35.79|-78.66
Cuernavaca|Morelos|MX|18.93|-99.23
Markham|Ontario|CA|43.87|-79.27
Sao Vicente|Sao Paulo|BR|-23.96|-46.39
Kaesong|Kaesong|KP|37.97|126.55
Tungi|Dhaka Division|BD|23.89|90.4
Krasnogvargeisky|St.-Petersburg|RU|59.97|30.48
Randburg|Gauteng|ZA|-26.09|28
Safi|Marrakesh-Safi|MA|32.3|-9.24
Simferopol|Crimea|UA|44.96|34.11
Lublin|Lublin|PL|51.25|22.57
Pelotas|Rio Grande do Sul|BR|-31.77|-52.34
San Jose|San Jose|CR|9.93|-84.08
Orlando|FL|US|28.54|-81.38
Vina del Mar|Valparaiso|CL|-33.02|-71.55
Qazvin|Qazvin Province|IR|36.27|50
Asahikawa|Hokkaido|JP|43.77|142.36
Kamarhati|West Bengal|IN|22.67|88.37
Tepic|Nayarit|MX|21.51|-104.89
Wonju|Gangwon-do|KR|37.35|127.95
Wad Medani|Al Jazirah|SD|14.4|33.52
Quan Muoi Mot|Ho Chi Minh City (HCMC)|VN|10.76|106.64
Nukus|Karakalpakstan|UZ|42.46|59.61
Konak|Izmir Province|TR|38.4|27.1
Maebashi|Gunma|JP|36.4|139.08
Kita|Tokyo|JP|35.75|139.73
Ciudad Victoria|Tamaulipas|MX|23.74|-99.14
Soledad de Graciano Sanchez|San Luis Potosi|MX|22.19|-100.94
Kochi|Kochi|JP|33.55|133.53
Bielefeld|North Rhine-Westphalia|DE|52.03|8.53
Blida|Blida|DZ|36.47|2.83
Kwai Chung|Kwai Tsing District|HK|22.37|114.14
Mandaue City|Central Visayas|PH|10.32|123.92
Ganja|Ganja City|AZ|40.68|46.36
Khorramshahr|Khuzestan|IR|30.44|48.18
Bonn|North Rhine-Westphalia|DE|50.73|7.1
Mathura|Uttar Pradesh|IN|27.5|77.67
Hechi|Guangxi|CN|24.69|108.08
Bydgoszcz|Kujawsko-Pomorskie|PL|53.12|18.01
Smolensk|Smolensk Oblast|RU|54.78|32.05
Oral|West Kazakhstan|KZ|51.25|51.43
Khorramabad|Lorestan Province|IR|33.49|48.36
Soyapango|San Salvador Department|SV|13.71|-89.14
Tongshan|Jiangsu|CN|34.18|117.16
Guediawaye|Dakar|SN|14.77|-17.4
Plovdiv|Plovdiv|BG|42.15|24.75
Ciudad Obregon|Sonora|MX|27.49|-109.94
Wonsan|Kangwon-do|KP|39.15|127.44
Brent|England|GB|51.55|-0.3
Pavlodar|Pavlodar Region|KZ|52.28|76.97
Chanda|Maharashtra|IN|19.95|79.3
Canoas|Rio Grande do Sul|BR|-29.92|-51.18
Koriyama|Fukushima|JP|37.4|140.38
Sochi|Krasnodar Krai|RU|43.6|39.72
Aksaray|Aksaray|TR|38.37|34.03
Vijayapura|Karnataka|IN|16.82|75.72
Chipata|Eastern Province|ZM|-13.63|32.65
Chongjin|North Hamgyong|KP|41.8|129.78
Yanji|Jilin|CN|42.89|129.5
Roodepoort|Gauteng|ZA|-26.16|27.87
Pucallpa|Ucayali|PE|-8.38|-74.55
Mogi das Cruzes|Sao Paulo|BR|-23.52|-46.19
Cordoba|Andalusia|ES|37.89|-4.77
Birkenhead|England|GB|53.39|-3.01
Nantes|Pays de la Loire|FR|47.22|-1.55
Ilesa|Osun State|NG|7.63|4.74
Pekalongan|Central Java|ID|-6.89|109.68
Bhatara|Dhaka Division|BD|23.8|90.45
Espoo|Uusimaa|FI|60.21|24.65
Kikuyu|Kiambu County|KE|-1.25|36.66
Kluang|Johor|MY|2.03|103.32
Lincang|Yunnan|CN|23.88|100.09
Nottingham|England|GB|52.95|-1.15
Ramiros|Luanda|AO|-9.06|13.05
Al 'Amarah|Maysan|IQ|31.84|47.14
Volzhsky|Volgograd Oblast|RU|48.79|44.78
Vaughan|Ontario|CA|43.84|-79.5
Xingyi|Guizhou|CN|25.1|104.91
Shivamogga|Karnataka|IN|13.93|75.57
Alwar|Rajasthan|IN|27.56|76.62
Uige|Uige|AO|-7.61|15.06
Taubate|Sao Paulo|BR|-23.03|-45.56
Ixtapaluca|Mexico|MX|19.32|-98.88
Osh|Osh Region|KG|40.53|72.8
Portoviejo|Manabi|EC|-1.06|-80.45
Villavicencio|Meta Department|CO|4.13|-73.63
Man'gyongdae-ri|Pyongyang|KP|38.99|125.66
Camacari|Bahia|BR|-12.7|-38.32
San Miguelito|Panama|PA|9.05|-79.47
Shahjanpur|Uttar Pradesh|IN|27.88|79.91
Lexington|KY|US|37.99|-84.48
Tantou|Guangdong|CN|22.75|113.83
Suzano|Sao Paulo|BR|-23.54|-46.31
Anapolis|Goias|BR|-16.33|-48.95
Kaech'on|South Pyongan|KP|39.7|125.89
Junagadh|Gujarat|IN|21.52|70.46
Islington|England|GB|51.54|-0.1
Hoa Lu|Ninh Binh|VN|20.26|105.98
Holguin|Holguin Province|CU|20.89|-76.26
Ust-Kamenogorsk|East Kazakhstan|KZ|49.97|82.61
Tsuen Wan|Tsuen Wan|HK|22.37|114.11
Zinder|Zinder Region|NE|13.81|8.99
Saransk|Mordoviya Republic|RU|54.18|45.17
Al Diwaniyah|Al-Qadisiyah|IQ|31.99|44.93
Varna|Varna|BG|43.22|27.91
Hafizabad|Punjab|PK|32.07|73.69
Marne La Vallee|Ile-de-France|FR|48.84|2.64
Palangkaraya|Central Kalimantan|ID|-2.21|113.92
Damanhur|Beheira|EG|31.03|30.47
Chiniot|Punjab|PK|31.72|72.98
Popayan|Cauca Department|CO|2.44|-76.61
Reading|England|GB|51.46|-0.97
Geita|Geita|TZ|-2.87|32.23
Constanta|Constanta County|RO|44.18|28.63
New Delhi|Delhi|IN|28.62|77.21
Thessaloniki|Central Macedonia|GR|40.64|22.93
Thies|Thies|SN|14.79|-16.93
Naha|Okinawa|JP|26.21|127.68
Riverside|CA|US|33.95|-117.4
Baicheng|Jilin|CN|45.62|122.83
Chimbote|Ancash|PE|-9.08|-78.59
Bari|Apulia|IT|41.12|16.87
Barueri|Sao Paulo|BR|-23.51|-46.88
Corpus Christi|TX|US|27.8|-97.4
Thrissur|Kerala|IN|10.52|76.22
Cherepovets|Vologda Oblast|RU|59.13|37.9
Eloy Alfaro|Guayas|EC|-2.17|-79.84
Hamburg-Nord|Hamburg|DE|53.59|9.98
Al-Kut|Wasit|IQ|32.51|45.82
Muar|Johor|MY|2.04|102.57
Sisli|Istanbul|TR|41.06|28.99
Lexington-Fayette|KY|US|38.05|-84.46
Maroua|Far North|CM|10.59|14.32
Kingston upon Hull|England|GB|53.74|-0.34
Preston|England|GB|53.76|-2.7
Lianshan|Liaoning|CN|40.76|120.85
Denizli|Denizli|TR|37.77|29.09
Ikeja|Lagos|NG|6.6|3.34
New Cairo|Cairo|EG|30.03|31.47
Al Qahirah al Jadidah||EG|30.04|31.44
Vitoria|Espirito Santo|BR|-20.32|-40.34
Palmira|Valle del Cauca Department|CO|3.53|-76.3
Vologda|Vologda Oblast|RU|59.22|39.88
Iligan City|Soccsksargen|PH|8.25|124.4
Catania|Sicily|IT|37.49|15.07
Jardim Angela|Sao Paulo|BR|-23.72|-46.77
Nizamabad|Telangana|IN|18.67|78.1
Cincinnati|OH|US|39.13|-84.51
Percut|North Sumatra|ID|3.63|98.86
Coatzacoalcos|Veracruz|MX|18.15|-94.44
Santa Ana|CA|US|33.75|-117.87
Sariwon-si|North Hwanghae|KP|38.51|125.76
Botshabelo|Free State|ZA|-29.27|26.73
Butuan|Caraga|PH|8.95|125.54
Shahriar|Tehran|IR|35.66|51.06
Qods|Tehran|IR|35.72|51.11
Gia Lam|Hanoi|VN|21.02|105.94
Kurgan|Kurgan Oblast|RU|55.45|65.34
Tampico|Tamaulipas|MX|22.29|-97.88
Akowonjo|Lagos|NG|6.61|3.31
Cabuyao|Calabarzon|PH|14.27|121.13
Tabora|Tabora|TZ|-5.02|32.83
Kasugai|Aichi|JP|35.25|136.97
An Nhon|Gia Lai|VN|13.89|109.11
Alimosho|Lagos|NG|6.61|3.3
Ciudad Benito Juarez|Nuevo Leon|MX|25.65|-100.09
Muenster|North Rhine-Westphalia|DE|51.96|7.63
Mannheim|Baden-Wurttemberg|DE|49.49|8.47
Karawang|West Java|ID|-6.31|107.32
Akita|Akita|JP|39.72|140.12
Tumkur|Karnataka|IN|13.34|77.1
Chinju|Gyeongsangnam-do|KR|35.19|128.08
Parbhani|Maharashtra|IN|19.27|76.77
Hisar|Haryana|IN|29.15|75.72
Iksan|Jeollabuk-do|KR|35.94|126.95
Firozabad|Uttar Pradesh|IN|27.15|78.4
Palmas|Tocantins|BR|-10.17|-48.33
Vladikavkaz|North Ossetia-Alania|RU|43.04|44.67
Port-de-Paix|Nord-Ouest|HT|19.94|-72.83
Damietta|Damietta|EG|31.42|31.81
Posadas|Misiones|AR|-27.39|-55.92
Parauapebas|Para|BR|-6.07|-49.9
Brakpan|Gauteng|ZA|-26.24|28.37
Stockton|CA|US|37.96|-121.29
Juazeiro do Norte|Ceara|BR|-7.21|-39.32
Yokkaichi|Mie|JP|34.97|136.62
Kulti|West Bengal|IN|23.73|86.84
Tlahuac|Mexico City|MX|19.29|-99.01
Sapele|Delta|NG|5.89|5.68
Kashan|Isfahan|IR|33.98|51.43
Pittsburgh|PA|US|40.44|-80
Armenia|Quindio Department|CO|4.54|-75.67
Santa Catarina|Nuevo Leon|MX|25.67|-100.46
Sumbawanga|Rukwa|TZ|-7.97|31.62
Orel|Oryol oblast|RU|52.97|36.08
Akashi|Hyogo|JP|34.66|135.01
Hai Ba Trung|Hanoi|VN|21.01|105.85
Kurume|Fukuoka|JP|33.32|130.52
Graz|Styria|AT|47.07|15.44
Saint Paul|MN|US|44.94|-93.09
Saltivskyi|Kharkiv|UA|50|36.32
Nghi Son|Thanh Hoa Province|VN|19.33|105.82
Karnal|Haryana|IN|29.69|76.98
Changyi|Shandong|CN|36.85|119.39
Ciudad del Este|Alto Parana Department|PY|-25.5|-54.65
Rosetta|Beheira|EG|31.4|30.42
Barddhaman|West Bengal|IN|23.26|87.86
Toshima|Tokyo|JP|35.76|139.74
Kediri|East Java|ID|-7.82|112.02
Solwezi|North-Western|ZM|-12.17|26.39
Hamburg-Mitte|Hamburg|DE|53.55|10.02
Augsburg|Bavaria|DE|48.37|10.9
South Dublin|Leinster|IE|53.29|-6.34
Valladolid|Castille and Leon|ES|41.66|-4.72
Miri|Sarawak|MY|4.4|113.99
Xinyi|Jiangsu|CN|34.38|118.35
Mardan|Khyber Pakhtunkhwa|PK|34.2|72.05
Surgut|Khanty-Mansia|RU|61.26|73.42
Swansea|Wales|GB|51.62|-3.94
San Pablo|Calabarzon|PH|14.07|121.33
Newcastle upon Tyne|England|GB|54.97|-1.61
Gundupalaiyam|Puducherry|IN|11.94|79.8
Varzea Grande|Mato Grosso|BR|-15.65|-56.13
Gatineau|Quebec|CA|45.48|-75.7
Yangshuo|Guangxi|CN|24.78|110.49
Binan|Calabarzon|PH|14.34|121.08
Malir Cantonment|Sindh|PK|24.94|67.21
Winejok|Northern Bahr al Ghazal|SS|9.01|27.57
Batikent|Ankara|TR|39.97|32.73
Merida|Merida|VE|8.58|-71.17
Linqu|Shandong|CN|36.52|118.54
Uruapan|Michoacan|MX|19.42|-102.06
Patan|Bagmati Province|NP|27.68|85.31
Fergana|Fergana|UZ|40.38|71.78
Bahia Blanca|Buenos Aires|AR|-38.72|-62.27
Santol|Central Luzon|PH|15.16|120.57
Kaolack|Kaolack|SN|14.15|-16.07
Jember|East Java|ID|-8.17|113.7
Aomori|Aomori|JP|40.82|140.73
Barasat|West Bengal|IN|22.72|88.48
Mulugu|Telangana|IN|18.19|79.94
Foz do Iguacu|Parana|BR|-25.55|-54.59
Bihar Sharif|Bihar|IN|25.2|85.52
Tegal|Central Java|ID|-6.87|109.14
Grozny|Chechnya|RU|43.31|45.69
Boma|Bas-Congo|CD|-5.85|13.05
Bali|West Bengal|IN|22.65|88.34
Pu'er|Yunnan|CN|22.79|100.97
Rampur|Uttar Pradesh|IN|28.81|79.03
Darbhanga|Bihar|IN|26.15|85.9
Panipat|Haryana|IN|29.39|76.97
Mwene|Lualaba|CD|-9.82|22.87
Bialystok|Podlasie|PL|53.13|23.16
Sao Jose|Santa Catarina|BR|-27.62|-48.63
Rufisque|Dakar|SN|14.72|-17.27
Murmansk|Murmansk|RU|68.97|33.1
Tirupati|Andhra Pradesh|IN|13.64|79.42
Southend-on-Sea|England|GB|51.54|0.71
Petropolis|Rio de Janeiro|BR|-22.5|-43.18
Guaruja|Sao Paulo|BR|-23.99|-46.26
Itajai|Santa Catarina|BR|-26.91|-48.66
Lincoln|NE|US|40.8|-96.67
Phu Quoc|An Giang|VN|10.22|103.97
Baiyin|Gansu|CN|36.55|104.17
Fukushima|Fukushima|JP|37.75|140.47
Bergen|Vestland|NO|60.39|5.32
Greater Noida|Uttar Pradesh|IN|28.5|77.54
Noida|Uttar Pradesh|IN|28.58|77.33
Tambov|Tambov Oblast|RU|52.74|41.44
Vigo|Galicia|ES|42.23|-8.72
Aizawl|Mizoram|IN|23.73|92.72
Banjarbaru|South Kalimantan|ID|-3.44|114.84
Thanh Xuan|Hanoi|VN|20.99|105.8
Al Hufuf|Eastern Province|SA|25.36|49.59
Cholula|Puebla|MX|19.06|-98.3
Gandhinagar|Gujarat|IN|23.22|72.68
Semey|Abai Region|KZ|50.42|80.25
Cau Giay|Hanoi|VN|21.03|105.8
Dindigul|Tamil Nadu|IN|10.37|77.98
Ponta Grossa|Parana|BR|-25.09|-50.16
Gaozhou|Guangdong|CN|21.92|110.86
Kamoke|Punjab|PK|31.98|74.22
Limeira|Sao Paulo|BR|-22.56|-47.4
Thanjavur|Tamil Nadu|IN|10.79|79.14
Kariega|Eastern Cape|ZA|-33.76|25.4
Adiyaman|Adiyaman Province|TR|37.76|38.28
Al Mubarraz|Eastern Province|SA|25.41|49.59
Resistencia|Chaco|AR|-27.46|-58.99
Morioka|Iwate|JP|39.7|141.15
Atyrau|Atyrau Oblisi|KZ|47.1|51.88
Sector 2|Bucharest|RO|44.45|26.13
Xiuying|Hainan|CN|20|110.29
San Cristobal|Tachira|VE|7.77|-72.24
Cileungsir|West Java|ID|-6.39|106.96
Karimnagar|Telangana|IN|18.44|79.13
Victoria|British Columbia|CA|48.44|-123.35
Anchorage|AK|US|61.22|-149.9
Dewas|Madhya Pradesh|IN|22.97|76.06
Batna|Batna|DZ|35.56|6.17
Kaunas|Kaunas|LT|54.9|23.91
Sonipat|Haryana|IN|28.99|77.02
Machala|El Oro|EC|-3.26|-79.96
Wiesbaden|Hesse|DE|50.09|8.24
Meads|KY|US|38.41|-82.71
Kabwe|Central Province|ZM|-14.45|28.45
Sinuiju|P'yongan-bukto|KP|40.1|124.4
Meguro|Tokyo|JP|35.63|139.7
Sector 4|Bucharest|RO|44.38|26.12
Sumida|Tokyo|JP|35.73|139.82
Ibaraki|Osaka|JP|34.82|135.57
Bac Ninh|Bac Ninh|VN|21.19|106.08
Ichalkaranji|Maharashtra|IN|16.69|74.46
Marienthal|Hamburg|DE|53.57|10.08
Phu My|Ho Chi Minh City (HCMC)|VN|10.63|107.07
Ceilandia|Federal District|BR|-15.81|-48.13
Katowice|Silesia|PL|50.26|19.02
Adapazari|Sakarya|TR|40.78|30.4
Cluj-Napoca|Cluj County|RO|46.77|23.6
Gunpo|Gyeonggi-do|KR|37.37|126.95
Songea|Ruvuma|TZ|-10.68|35.65
Butembo|North Kivu|CD|0.14|29.29
Tacna|Tacna|PE|-18.01|-70.25
Tin Shui Wai|Yuen Long|HK|22.46|114
Long Xuyen|An Giang|VN|10.39|105.44
Savar|Dhaka Division|BD|23.85|90.25
Bathinda|Punjab|IN|30.21|74.94
Henderson|NV|US|36.04|-114.98
Jalna|Maharashtra|IN|19.84|75.89
Sekondi|Western|GH|4.93|-1.71
Sao Goncalo|Rio de Janeiro|BR|-22.83|-43.05
Kyengera|Central Region|UG|0.3|32.5
Greensboro|NC|US|36.07|-79.79
Haifa|Haifa|IL|32.81|35
Arhus|Central Jutland|DK|56.16|10.21
Dengzhou|Henan|CN|32.68|112.09
Artux|Xinjiang|CN|39.71|76.18
Chuncheon|Gangwon-do|KR|37.87|127.73
Alto Barinas|Barinas|VE|8.59|-70.23
Mbour|Thies|SN|14.42|-16.96
Brighton|England|GB|50.83|-0.14
Karlsruhe|Baden-Wurttemberg|DE|49.01|8.4
Port Moresby|National Capital|PG|-9.48|147.15
Minya|Minya|EG|28.09|30.76
Plano|TX|US|33.02|-96.7
Maraba|Para|BR|-5.38|-49.13
Ichihara|Chiba|JP|35.52|140.08
Qibao|Shanghai|CN|31.15|121.36
Kirari Sulemannagar|Delhi|IN|28.7|77.06
Cainta|Calabarzon|PH|14.58|121.12
Satna|Madhya Pradesh|IN|24.58|80.83
Geelong|Victoria|AU|-38.15|144.36
Chernihiv|Chernihiv Oblast|UA|51.51|31.29
Xinyuan|Xinjiang|CN|43.43|83.25
Chapeco|Santa Catarina|BR|-27.1|-52.62
Ba Vi|Hanoi|VN|21.08|105.38
Valparaiso|Valparaiso|CL|-33.04|-71.63
Ica|Ica|PE|-14.08|-75.73
Purnia|Bihar|IN|25.78|87.47
Newark|NJ|US|40.74|-74.17
Itaguei|Antioquia|CO|6.18|-75.6
Nicolas Romero|Mexico|MX|19.64|-99.31
Gebze|Kocaeli|TR|40.8|29.43
Lichinga|Niassa Province|MZ|-13.31|35.24
Narsingdi|Dhaka Division|BD|23.92|90.72
Zeytinburnu|Istanbul|TR|40.99|28.9
Ostrava|Moravian-Silesian Region|CZ|49.83|18.28
Sfax|Sfax Governorate|TN|34.74|10.76
Zumpango|Mexico|MX|19.8|-99.1
Merkezefendi|Denizli|TR|37.81|29.04
Madison|WI|US|43.07|-89.4
Bukhara|Bukhara|UZ|39.77|64.43
Wollongong|New South Wales|AU|-34.42|150.89
Volta Redonda|Rio de Janeiro|BR|-22.52|-44.1
St. Louis|MO|US|38.63|-90.2
Poltava|Poltava|UA|49.59|34.55
Sumare|Sao Paulo|BR|-22.82|-47.27
Efon-Alaaye|Ekiti State|NG|7.66|4.92
Binjai|North Sumatra|ID|3.6|98.49
Pematangsiantar|North Sumatra|ID|2.96|99.07
Petrozavodsk|Karelia|RU|61.78|34.35
Enshi|Hubei|CN|30.3|109.48
Taganrog|Rostov|RU|47.24|38.91
Santa Teresa del Tuy|Miranda|VE|10.23|-66.66
Quang Ngai|Quang Ngai|VN|15.12|108.79
Qarshi|Qashqadaryo|UZ|38.86|65.79
Tanghe|Henan|CN|32.69|112.83
Demra|Dhaka Division|BD|23.71|90.48
Coacalco|Mexico|MX|19.63|-99.11
Sincelejo|Sucre Department|CO|9.3|-75.39
Khomeyni Shahr|Isfahan|IR|32.69|51.54
Kostroma|Kostroma Oblast|RU|57.77|40.93
Imphal|Manipur|IN|24.81|93.94
Gagnoa|Goh-Djiboua|CI|6.13|-5.95
Ulu Bedok||SG|1.33|103.93
Bedok New Town||SG|1.33|103.94
Owo|Ondo State|NG|7.2|5.59
Suncheon|Jeollanam-do|KR|34.95|127.49
Fangchenggang|Guangxi|CN|21.77|108.36
Komsomolsk-on-Amur|Khabarovsk|RU|50.55|137.01
Abbottabad|Khyber Pakhtunkhwa|PK|34.15|73.21
Kaili|Guizhou|CN|26.59|107.98
Hakodate|Hokkaido|JP|41.78|140.74
Yamoussoukro|Lacs District|CI|6.82|-5.28
Bab Ezzouar|Algiers|DZ|36.73|3.18
Strasbourg|Grand Est|FR|48.58|7.75
Saugor|Madhya Pradesh|IN|23.84|78.74
Neihu|Taiwan|TW|25.08|121.59
Tsu|Mie|JP|34.73|136.52
Xingning|Guangdong|CN|24.15|115.72
Linxia Chengguanzhen|Gansu|CN|35.6|103.21
Khmelnytskyi|Khmelnytskyi|UA|49.42|26.98
Kushinagar|Uttar Pradesh|IN|26.74|83.89
Saddiqabad|Punjab|PK|28.31|70.13
Loja|Loja|EC|-3.99|-79.2
Tai Po|Tai Po|HK|22.45|114.17
Isfara|Sughd|TJ|40.13|70.63
Luena|Moxico|AO|-11.78|19.92
Taboao da Serra|Sao Paulo|BR|-23.63|-46.79
Istaravshan|Sughd|TJ|39.91|69
Turpan|Xinjiang|CN|42.95|89.18
Rourkela|Odisha|IN|22.22|84.86
Yao|Osaka|JP|34.62|135.6
Bani Suwayf|Beni Suweif|EG|29.07|31.1
Imperatriz|Maranhao|BR|-5.53|-47.49
Nagar Naluakot|Dhaka Division|BD|24.16|90.77
Guantanamo|Guantanamo Province|CU|20.14|-75.21
Baguio|Cordillera|PH|16.42|120.59
Ar Rayyan|Baladiyat ar Rayyan|QA|25.29|51.42
Polokwane|Limpopo|ZA|-23.9|29.47
Ljubljana|Ljubljana|SI|46.05|14.51
Jalalabad|Nangarhar|AF|34.43|70.45
Deir ez-Zor|Deir ez-Zor|SY|35.34|40.14
Gijon|Asturias|ES|43.54|-5.66
Santa Maria|Rio Grande do Sul|BR|-29.68|-53.81
Parnamirim|Rio Grande do Norte|BR|-5.92|-35.26
Hafar Al-Batin|Eastern Province|SA|28.43|45.97
Kakogawacho-honmachi|Hyogo|JP|34.77|134.83
Sector 5|Bucharest|RO|44.39|26.07
Quan Sau|Ho Chi Minh City (HCMC)|VN|10.75|106.65
Capao Redondo|Sao Paulo|BR|-23.67|-46.78
My Tho|Dong Thap|VN|10.36|106.36
Mito|Ibaraki|JP|36.35|140.45
Derby|England|GB|52.92|-1.48
Dessie|Amhara|ET|11.13|39.63
Ha Long|Quang Ninh|VN|20.95|107.07
Gelsenkirchen|North Rhine-Westphalia|DE|51.51|7.1
Longling County|Yunnan|CN|24.59|98.69
Cherkasy|Cherkasy|UA|49.44|32.06
Malolos|Central Luzon|PH|14.84|120.81
Southampton|England|GB|50.9|-1.4
Kapar|Selangor|MY|3.13|101.38
Corum|Corum|TR|40.55|34.95
Ghulja|Xinjiang|CN|43.92|81.32
Eimsbuettel|Hamburg|DE|53.57|9.96
Merlo|Buenos Aires|AR|-34.67|-58.73
Yeosu|Jeollanam-do|KR|34.76|127.66
Durg|Chhattisgarh|IN|21.19|81.28
Fuling|Chongqing|CN|29.71|107.39
Mokpo|Jeollanam-do|KR|34.81|126.39
Birganj|Madhesh|NP|27.02|84.88
Yoshkar-Ola|Mariy-El Republic|RU|56.64|47.89
Russeifa|Zarqa|JO|32.02|36.05
Banda Aceh|Aceh|ID|5.54|95.33
Shibin al Kawm|Monufia|EG|30.55|31.01
Mirpur Khas|Sindh|PK|25.53|69.01
Sengkang New Town||SG|1.39|103.89
Floridablanca|Santander Department|CO|7.06|-73.09
Tokushima|Tokushima|JP|34.07|134.57
Sterlitamak|Bashkortostan Republic|RU|53.64|55.95
Anantapur|Andhra Pradesh|IN|14.68|77.61
Gyeongsan-si|Gyeongsangbuk-do|KR|35.82|128.74
Sohag|Sohag|EG|26.56|31.69
Nagaoka|Niigata|JP|37.45|138.85
Sapopemba|Sao Paulo|BR|-23.6|-46.52
Saint-Marc|Artibonite|HT|19.11|-72.7
Governador Valadares|Minas Gerais|BR|-18.85|-41.95
Eixample|Catalonia|ES|41.39|2.16
Sao Carlos|Sao Paulo|BR|-22.02|-47.89
Bagerhat|Khulna Division|BD|22.66|89.79
Az-Zuhur|Port Said|EG|31.27|32.26
Ha Tinh|Ha Tinh Province|VN|18.34|105.91
Saskatoon|Saskatchewan|CA|52.13|-106.67
Chengzhong|Hubei|CN|30.94|113.55
Djelfa|Djelfa|DZ|34.67|3.26
Chula Vista|CA|US|32.64|-117.08
Shimonoseki|Yamaguchi|JP|33.96|130.94
Toledo|OH|US|41.66|-83.56
Ulanhot|Inner Mongolia|CN|46.08|122.08
Kibaha|Pwani|TZ|-6.77|38.92
Hulan Ergi|Heilongjiang|CN|47.2|123.63
Tampines Estate||SG|1.36|103.94
Bordeaux|New Aquitaine|FR|44.84|-0.58
Aachen|North Rhine-Westphalia|DE|50.78|6.08
Gent|Flanders|BE|51.05|3.72
Gravatai|Rio Grande do Sul|BR|-29.94|-50.99
Cite Soleil|Ouest|HT|18.58|-72.34
Mantampay|Northern Mindanao|PH|8.17|124.22
Ratlam|Madhya Pradesh|IN|23.33|75.04
Nogales|Sonora|MX|31.31|-110.94
El Daein|Eastern Darfur|SD|11.46|26.13
Donghai|Guangdong|CN|22.95|115.64
Dezful|Khuzestan|IR|32.38|48.41
Gunsan|Jeollabuk-do|KR|35.98|126.71
Mossoro|Rio Grande do Norte|BR|-5.19|-37.34
Macae|Rio de Janeiro|BR|-22.38|-41.78
Ranipet|Tamil Nadu|IN|12.92|79.33
Brahmanbaria|Chittagong|BD|23.97|91.11
Porto-Novo|Oueme|BJ|6.5|2.6
Chernivtsi|Chernivtsi|UA|48.29|25.93
Jersey City|NJ|US|40.73|-74.08
Manta|Manabi|EC|-0.95|-80.73
Reno|NV|US|39.53|-119.81
Begoua|Ombella-M'Poko|CF|4.45|18.53
Riobamba|Chimborazo Province|EC|-1.67|-78.66
Sivas|Sivas|TR|39.75|37.02
Dourados|Mato Grosso do Sul|BR|-22.22|-54.81
Rondonopolis|Mato Grosso|BR|-16.47|-54.64
Wolverhampton|England|GB|52.59|-2.12
Huayin|Shaanxi|CN|34.57|110.07
Pasarkemis|West Java|ID|-6.17|106.53
Fanling|North District|HK|22.49|114.14
Chiayi City|Taiwan|TW|23.48|120.45
Dongtai|Jiangsu|CN|32.85|120.31
Fuchu|Tokyo|JP|35.67|139.48
Jurong Town||SG|1.33|103.72
Maragheh|East Azerbaijan|IR|37.39|46.24
Maragheh|Razavi Khorasan|IR|35.83|59.63
Quilmes|Buenos Aires|AR|-34.72|-58.25
Fukui-shi|Fukui|JP|36.06|136.22
Lal Bahadur Nagar|Telangana|IN|17.35|78.56
Moenchengladbach|North Rhine-Westphalia|DE|51.19|6.44
Bagong Silang|National Capital Region|PH|14.78|121.04
Zhytomyr|Zhytomyr Oblast|UA|50.26|28.68
Karamay|Xinjiang|CN|45.58|84.89
Sacoma|Sao Paulo|BR|-23.63|-46.6
Arrah|Bihar|IN|25.56|84.66
Tongliao|Inner Mongolia|CN|43.61|122.27
Bariadi|Simiyu|TZ|-2.8|33.98
Antsirabe|Vakinankaratra|MG|-19.87|47.03
Chandler|AZ|US|33.31|-111.84
Yei|Central Equatoria|SS|4.09|30.68
Chilanzar|Tashkent|UZ|41.28|69.18
Tampere|Pirkanmaa|FI|61.5|23.79
Mahajanga|Boeny|MG|-15.72|46.32
Minato City|Tokyo|JP|35.66|139.75
Fort Wayne|IN|US|41.13|-85.13
Plymouth|England|GB|50.37|-4.14
Nianbo|Qinghai|CN|36.48|102.42
Baranagar|West Bengal|IN|22.64|88.38
Skardu|Gilgit-Baltistan|PK|35.3|75.63
Marawi City|Autonomous Region in Muslim Mindanao|PH|8|124.28
Tampines New Town||SG|1.35|103.95
Embu das Artes|Sao Paulo|BR|-23.65|-46.85
Qo'qon|Fergana|UZ|40.53|70.94
Jardim Sao Luis|Sao Paulo|BR|-23.68|-46.74
Tacloban|Eastern Visayas|PH|11.24|125
Sao Jose de Ribamar|Maranhao|BR|-2.56|-44.06
Changle|Shandong|CN|36.71|118.83
Gajuwaka|Andhra Pradesh|IN|17.7|83.22
Jining|Inner Mongolia|CN|41.03|113.11
North Shore|Auckland|NZ|-36.8|174.75
Rishon LeTsiyyon|Central District|IL|31.97|34.79
Hiratsuka|Kanagawa|JP|35.33|139.34
Stoke-on-Trent|England|GB|53|-2.19
Buffalo|NY|US|42.89|-78.88
Verona|Veneto|IT|45.44|10.99
Da Lat|Lam Dong|VN|11.95|108.44
San Salvador de Jujuy|Jujuy|AR|-24.19|-65.29
Durham|NC|US|35.99|-78.9
Shiqi|Guangdong|CN|22.52|113.39
Etawah|Uttar Pradesh|IN|26.78|79.02
Gasteiz / Vitoria|Basque Country|ES|42.85|-2.67
Rugao|Jiangsu|CN|32.37|120.58
Gomez Palacio|Durango|MX|25.57|-103.5
St. Petersburg|FL|US|27.77|-82.68
L'Hospitalet de Llobregat|Catalonia|ES|41.36|2.1
Gdynia|Pomerania|PL|54.52|18.53
Cilacap|Central Java|ID|-7.73|109.01
Irvine|CA|US|33.67|-117.82
Kitchener|Ontario|CA|43.43|-80.51
Suicheng|Jiangsu|CN|33.9|117.93
Nada|Hainan|CN|19.52|109.58
Latina|Madrid|ES|40.39|-3.75
Los Mochis|Sinaloa|MX|25.79|-109
Bratsk|Irkutsk Oblast|RU|56.13|101.61
Pachuca de Soto|Hidalgo|MX|20.12|-98.73
Chingola|Copperbelt|ZM|-12.53|27.88
Sumy|Sumy|UA|50.92|34.8
Milton Keynes|England|GB|52.04|-0.76
Indaiatuba|Sao Paulo|BR|-23.09|-47.21
Laredo|TX|US|27.51|-99.51
Juazeiro|Bahia|BR|-9.41|-40.5
Vila Flor|Luanda|AO|-8.98|13.31
Germiston|Gauteng|ZA|-26.21|28.16
Nunoa|Santiago Metropolitan|CL|-33.45|-70.58
Parakou|Borgou|BJ|9.34|2.63
Isiro|Haut-Uele|CD|2.77|27.62
Sari|Mazandaran|IR|36.56|53.06
Tarakan|North Kalimantan|ID|3.31|117.59
Kenema|Eastern Province|SL|7.88|-11.19
Oaxaca|Oaxaca|MX|17.06|-96.73
Mossamedes|Namibe|AO|-15.2|12.15
Al Madinah|Basra|IQ|30.96|47.27
Hobart|Tasmania|AU|-42.88|147.33
Ikot Ekpene|Akwa Ibom State|NG|5.18|7.71
Woodlands||SG|1.44|103.79
Hanam|Gyeonggi-do|KR|37.54|127.21
Mueang Nonthaburi|Nonthaburi|TH|13.86|100.51
Muridke|Punjab|PK|31.8|74.26
Saint-Louis|Saint-Louis|SN|16.02|-16.49
Batu Caves|Selangor|MY|3.24|101.68
Novo Hamburgo|Rio Grande do Sul|BR|-29.68|-51.13
Jurong West||SG|1.35|103.72
Singkawang|West Kalimantan|ID|0.91|108.98
Cox's Bazar|Chittagong|BD|21.44|92.01
Carabanchel|Madrid|ES|40.39|-3.72
Cotia|Sao Paulo|BR|-23.6|-46.92
Petah Tiqva|Central District|IL|32.09|34.89
Marg'ilon|Fergana|UZ|40.47|71.72
Ambarnath|Maharashtra|IN|19.2|73.17
Godome|Atlantique|BJ|6.39|2.35
Naihati|West Bengal|IN|22.89|88.42
Brasov|Brasov County|RO|45.65|25.61
Xuan Loc|Dong Nai|VN|10.93|107.23
Richards Bay|KwaZulu-Natal|ZA|-28.78|32.04
Qina|Qena|EG|26.16|32.73
Bharatpur|Rajasthan|IN|27.22|77.49
Vantaa|Uusimaa|FI|60.29|25.04
Porto|Porto|PT|41.15|-8.61
Kiel|Schleswig-Holstein|DE|54.32|10.13
El Fasher|Northern Darfur|SD|13.63|25.35
Thies Nones|Thies|SN|14.78|-16.97
Suihua|Heilongjiang|CN|46.65|126.97
Los Teques|Miranda|VE|10.35|-67.04
Santiago del Estero|Santiago del Estero|AR|-27.8|-64.26
Setif|Setif|DZ|36.19|5.41
Begusarai|Bihar|IN|25.42|86.13
Borujerd|Lorestan Province|IR|33.9|48.75
Qarchak|Tehran|IR|35.43|51.58
Afyonkarahisar|Afyonkarahisar Province|TR|38.76|30.54
Iskenderun|Hatay|TR|36.59|36.17
Santiago de Surco|Lima region|PE|-12.14|-77.01
Maracanau|Ceara|BR|-3.88|-38.63
Ota|Ogun State|NG|6.69|3.23
Thika|Nairobi County|KE|-1.03|37.07
San Fernando|Central Luzon|PH|15.03|120.68
Menongue|Cubango|AO|-14.66|17.69
Hayy Khilda|Amman|JO|31.99|35.84
Jacarei|Sao Paulo|BR|-23.31|-45.97
Jimma|Oromiya|ET|7.67|36.83
Timisoara|Timis County|RO|45.75|21.23
Santa Clara|Villa Clara Province|CU|22.41|-79.97
Iwo|Osun State|NG|7.64|4.18
A Coruna|Galicia|ES|43.37|-8.4
Libertad|Caraga|PH|8.94|125.5
Altona|Hamburg|DE|53.55|9.93
La Paz|Baja California Sur|MX|24.14|-110.31
Kelar|Sulaymaniyah|IQ|34.63|45.32
Colonia del Valle|Mexico City|MX|19.39|-99.16
Nis|Central Serbia|RS|43.32|21.9
Singa|Sennar|SD|13.15|33.93
San Bernardo|Santiago Metropolitan|CL|-33.59|-70.7
Soka|Saitama|JP|35.84|139.8
Mzuzu|Northern Region|MW|-11.47|34.02
Navotas|National Capital Region|PH|14.67|120.95
Tiruvottiyur|Tamil Nadu|IN|13.16|80.3
Cidade Ademar|Sao Paulo|BR|-23.67|-46.66
Burnaby|British Columbia|CA|49.27|-122.95
Lubbock|TX|US|33.58|-101.86
Palermo|Buenos Aires F.D.|AR|-34.59|-58.43
Thi Tran GJong Trieu|Quang Ninh|VN|21.08|106.51
Thuqbah|Eastern Province|SA|26.26|50.2
Yamagata|Yamagata|JP|38.23|140.37
Tehuacan|Puebla|MX|18.46|-97.4
Guarenas|Miranda|VE|10.47|-66.62
Laferrere|Buenos Aires|AR|-34.75|-58.58
Montpellier|Occitanie|FR|43.61|3.88
Jimeta|Adamawa|NG|9.28|12.46
Czestochowa|Silesia|PL|50.8|19.12
Gandhidham|Gujarat|IN|23.08|70.13
Beibei|Chongqing|CN|29.83|106.44
Insein|Yangon|MM|16.89|96.1
City of Westminster|England|GB|51.5|-0.14
Gilbert|AZ|US|33.35|-111.79
Chemnitz|Saxony|DE|50.84|12.93
Parana|Entre Rios|AR|-31.73|-60.53
San Miguel|San Miguel Department|SV|13.48|-88.18
Shijie|Guangdong|CN|23.1|113.79
Chitato|Luanda Norte|AO|-7.3|20.73
Orsk|Orenburg Oblast|RU|51.23|58.49
Vanderbijlpark|Gauteng|ZA|-26.71|27.84
Coro|Falcon|VE|11.41|-69.68
Americana|Sao Paulo|BR|-22.74|-47.33
Hami|Xinjiang|CN|42.83|93.51
Gaborone|Gaborone|BW|-24.65|25.91
Al 'Ashir min Ramadan|Sharqia|EG|30.3|31.75
Mau|Uttar Pradesh|IN|25.94|83.56
Puerto Montt|Los Lagos Region|CL|-41.47|-72.94
Northampton|England|GB|52.25|-0.88
Juliaca|Puno|PE|-15.5|-70.13
Fuji|Shizuoka|JP|35.17|138.68
Gyeongju|Gyeongsangbuk-do|KR|35.84|129.21
Aguas Lindas de Goias|Goias|BR|-15.76|-48.28
Sinfra|Zanzan District|CI|6.62|-5.91
Syktyvkar|Komi|RU|61.66|50.82
Gorgan|Golestan|IR|36.84|54.44
Nizhnevartovsk|Khanty-Mansia|RU|60.93|76.55
Shahkot|Punjab|PK|31.57|73.49
Groningen|Groningen|NL|53.22|6.57
Biratnagar|Koshi|NP|26.46|87.27
Braunschweig|Lower Saxony|DE|52.27|10.53
Valera|Trujillo|VE|9.32|-70.6
Sikar|Rajasthan|IN|27.61|75.14
Bago|Bago Region|MM|17.34|96.48
Magdeburg|Saxony-Anhalt|DE|52.13|11.63
Baruta|Miranda|VE|10.43|-66.88
Puente de Vallecas|Madrid|ES|40.39|-3.66
Mage|Rio de Janeiro|BR|-22.65|-43.04
Trabzon|Trabzon|TR|41.01|39.73
Tri-Cities|WA|US|46.25|-119.2
Jessore|Khulna Division|BD|23.17|89.21
Manisa|Manisa|TR|38.61|27.43
Arapiraca|Alagoas|BR|-9.75|-36.66
Rivne|Rivne Oblast|UA|50.62|26.24
Padangsidempuan|North Sumatra|ID|1.38|99.27
Probolinggo|East Java|ID|-7.75|113.22
Sabzevar|Razavi Khorasan|IR|36.21|57.68
Musaffah|Abu Dhabi|AE|24.36|54.48
Brasilandia|Sao Paulo|BR|-23.45|-46.69
Sasebo|Nagasaki|JP|33.17|129.73
Angarsk|Irkutsk Oblast|RU|52.56|103.91
Mar'ino|Moscow|RU|55.65|37.72
Ramagundam|Telangana|IN|18.75|79.47
Hapur|Uttar Pradesh|IN|28.73|77.78
Chigasaki|Kanagawa|JP|35.34|139.4
Toli-Toli|Central Sulawesi|ID|1.04|120.82
Chofu|Tokyo|JP|35.66|139.55
Berbera|Woqooyi Galbeed|SO|10.44|45.01
Jiyuan|Henan|CN|35.09|112.59
Yamato|Kanagawa|JP|35.47|139.45
Man|Montagnes|CI|7.41|-7.55
Bahawalnagar|Punjab|PK|30|73.25
Novorossiysk|Krasnodar Krai|RU|44.73|37.76
Tsukuba|Ibaraki|JP|36.08|140.12
Arica|Arica y Parinacota Region|CL|-18.48|-70.3
Penalolen|Santiago Metropolitan|CL|-33.47|-70.53
Rio Verde|Goias|BR|-17.8|-50.93
Laohekou|Hubei|CN|32.39|111.67
Hai Duong|Hai Phong|VN|20.94|106.33
Winston-Salem|NC|US|36.1|-80.24
Farrukhabad|Uttar Pradesh|IN|27.39|79.58
Matsumoto|Nagano|JP|36.23|137.97
Alappuzha|Kerala|IN|9.49|76.33
Itapevi|Sao Paulo|BR|-23.55|-46.93
Katihar|Bihar|IN|25.54|87.57
Ciudad Ojeda|Zulia|VE|10.2|-71.31
Gucun|Shanghai|CN|31.35|121.39
Glendale|AZ|US|33.54|-112.19
Xiulin|Hubei|CN|29.72|112.4
Navegantes|Benguela|AO|-12.59|13.39
Bunkyo|Kanagawa|JP|35.53|139.42
Itaborai|Rio de Janeiro|BR|-22.74|-42.86
Klang|Selangor|MY|3.04|101.44
Almendares|Havana|CU|23.11|-82.42
Golestan|Tehran|IR|35.52|51.18
Vyhurivshchyna-Troyeshchyna|Kyiv City|UA|50.51|30.6
Khimki|Moscow Oblast|RU|55.9|37.43
Horlivka|Donetsk|UA|48.3|38.02
Nacala|Nampula|MZ|-14.56|40.69
Obolon|Kyiv City|UA|50.51|30.51
Xiantao|Hubei|CN|30.37|113.44
Nalchik|Kabardino-Balkariya Republic|RU|43.5|43.62
Hachinohe|Aomori|JP|40.5|141.5
Sete Lagoas|Minas Gerais|BR|-19.47|-44.25
Osan|Gyeonggi-do|KR|37.15|127.07
Fuencarral|Madrid|ES|40.5|-3.68
Lille|Hauts-de-France|FR|50.63|3.06
Neyagawa|Osaka|JP|34.77|135.63
Ormoc|Eastern Visayas|PH|11.01|124.61
Cabo Frio|Rio de Janeiro|BR|-22.89|-42.03
Magdalena Contreras|Mexico City|MX|19.33|-99.21
Nagarpur|Dhaka Division|BD|24.06|89.88
Kasulu|Kigoma|TZ|-4.58|30.1
Ngaoundere|Adamaoua|CM|7.33|13.58
Ivano-Frankivsk|Ivano-Frankivsk|UA|48.92|24.71
Balikesir|Balikesir|TR|39.65|27.89
Temuco|Araucania|CL|-38.74|-72.6
Norfolk|VA|US|36.85|-76.29
Krefeld|North Rhine-Westphalia|DE|51.34|6.55
Halle (Saale)|Saxony-Anhalt|DE|51.48|11.98
Sri Ganganagar|Rajasthan|IN|29.92|73.87
Marilia|Sao Paulo|BR|-22.21|-49.95
Amarapura|Mandalay Region|MM|21.91|96.05
Kilamba|Luanda|AO|-8.85|13.28
Amol|Mazandaran|IR|36.47|52.35
Freiburg|Baden-Wurttemberg|DE|48|7.85
Athlone|Western Cape|ZA|-33.97|18.5
Batangas|Calabarzon|PH|13.76|121.06
Al Jubayl|Eastern Province|SA|27.02|49.62
Tokch'on|South Pyongan|KP|39.75|126.26
Oldham|England|GB|53.54|-2.12
Pathein|Ayeyarwady|MM|16.78|94.73
Hialeah|FL|US|25.86|-80.28
Kunri|Sindh|PK|25.18|69.57
Sylhet|Sylhet Division|BD|24.9|91.87
Paarl|Western Cape|ZA|-33.73|18.98
Garland|TX|US|32.91|-96.64
Podgorica|Podgorica|ME|42.44|19.26
Scottsdale|AZ|US|33.51|-111.9
Hortolandia|Sao Paulo|BR|-22.86|-47.22
Irving|TX|US|32.81|-96.95
Centurion|Gauteng|ZA|-25.86|28.19
Qingzhou|Shandong|CN|36.7|118.48
Pakdasht|Tehran|IR|35.48|51.68
Kajang|Selangor|MY|2.99|101.79
Campo Limpo|Sao Paulo|BR|-23.64|-46.77
Yuci|Shanxi|CN|37.68|112.73
Sant Marti|Catalonia|ES|41.42|2.2
Eindhoven|North Brabant|NL|51.44|5.48
Boise|ID|US|43.61|-116.2
Rewa|Madhya Pradesh|IN|24.53|81.29
Yakutsk|Sakha|RU|62.03|129.72
Bole|Xinjiang|CN|44.89|82.07
Muzaffargarh|Punjab|PK|30.07|71.19
Chesapeake|VA|US|36.82|-76.27
Uluberiya|West Bengal|IN|22.48|88.1
Ipatinga|Minas Gerais|BR|-19.47|-42.54
Dali|Yunnan|CN|25.58|100.21
Najafabad|Isfahan|IR|32.63|51.37
Thanh Pho Ba Ria|Ho Chi Minh City (HCMC)|VN|10.5|107.17
Georgetown|Demerara-Mahaica|GY|6.8|-58.16
Xiangxiang|Hunan|CN|27.73|112.53
Kismayo|Lower Juba|SO|-0.36|42.55
North Las Vegas|NV|US|36.2|-115.12
Elche|Valencia|ES|38.26|-0.7
Presidente Prudente|Sao Paulo|BR|-22.13|-51.39
Sivakasi|Tamil Nadu|IN|9.45|77.8
Kindu|Maniema|CD|-2.94|25.92
Digri|Sindh|PK|25.16|69.11
Nizhnekamsk|Tatarstan Republic|RU|55.64|51.82
Karur|Tamil Nadu|IN|10.96|78.08
Lubuklinggau|South Sumatra|ID|-3.29|102.86
Craiova|Dolj|RO|44.32|23.8
Raichur|Karnataka|IN|16.21|77.36
Pallavaram|Tamil Nadu|IN|12.97|80.15
Danli|El Paraiso Department|HN|14.03|-86.58
Yongkang|Taiwan|TW|23.02|120.26
Bo|Southern Province|SL|7.96|-11.74
Granada|Andalusia|ES|37.19|-3.61
Ooty|Tamil Nadu|IN|11.41|76.7
Saga|Saga|JP|33.23|130.3
Magugpo Poblacion|Davao Region|PH|7.45|125.8
Dzerzhinsk|Nizhny Novgorod Oblast|RU|56.24|43.46
Pemba|Cabo Delgado Province|MZ|-12.97|40.52
Geoje|Gyeongsangnam-do|KR|34.81|128.71
Teluk Intan|Perak|MY|4.02|101.02
Singida|Singida|TZ|-4.82|34.74
Kigoma|Kigoma|TZ|-4.88|29.63
Colombo|Parana|BR|-25.29|-49.22
Fremont|CA|US|37.55|-121.99
Kampong Baharu Cheras Batu Sebelas|Selangor|MY|3.05|101.77
Viamao|Rio Grande do Sul|BR|-30.08|-51.02
Jiayuguan|Gansu|CN|39.81|98.29
Abadan|Khuzestan|IR|30.34|48.3
Taytay|Calabarzon|PH|14.56|121.13
Pho Yen|Thai Nguyen|VN|21.42|105.89
Neuquen|Neuquen|AR|-38.95|-68.06
Divinopolis|Minas Gerais|BR|-20.14|-44.89
Tuerkmenabat|Lebap|TM|39.07|63.58
Shibuya|Tokyo|JP|35.66|139.71
Son Tay|Hanoi|VN|21.14|105.51
Ninh Hoa|Khanh Hoa|VN|12.49|109.12
Pasir Mas|Kelantan|MY|6.05|102.14
Purwokerto|Central Java|ID|-7.42|109.23
Jose C. Paz|Buenos Aires|AR|-34.52|-58.77
Marka|Lower Shabeelle|SO|1.72|44.77
Pali|Rajasthan|IN|25.77|73.32
Halwan|Cairo|EG|29.84|31.3
Atani|Anambra|NG|6.01|6.75
Mariupol|Donetsk|UA|47.1|37.54
Huanren|Liaoning|CN|41.26|125.37
Changzheng|Shanghai|CN|31.24|121.37
Kasukabe|Saitama|JP|35.98|139.75
Paris 15 Vaugirard|Ile-de-France|FR|48.84|2.3
Windsor|Ontario|CA|42.3|-83.02
Hosur|Tamil Nadu|IN|12.74|77.83
Spokane|WA|US|47.66|-117.43
Tripoli|North Lebanon|LB|34.43|35.84
Longueuil|Quebec|CA|45.52|-73.47
Ordu|Ordu|TR|40.98|37.89
San Fernando de Apure|Apure|VE|7.89|-67.47
Croix-des-Bouquets|Ouest|HT|18.58|-72.23
Lucena|Calabarzon|PH|13.93|121.62
Yishun New Town||SG|1.43|103.83
Vizianagaram|Andhra Pradesh|IN|18.12|83.41
Jinchang|Gansu|CN|38.5|102.19
Phan Thiet|Lam Dong|VN|10.93|108.1
Sabya|Jazan Region|SA|17.15|42.63
Netanya|Central District|IL|32.33|34.86
Ciudad Lineal|Madrid|ES|40.45|-3.65
Meycauayan|Central Luzon|PH|14.74|120.96
Bexley|England|GB|51.44|0.15
Aliayabiagba|Lagos|NG|6.45|3.33
Nassau|New Providence|BS|25.06|-77.34
San Lorenzo|Central Department|PY|-25.34|-57.51
Rennes|Brittany|FR|48.11|-1.67
Mohammedia|Casablanca-Settat|MA|33.69|-7.38
Guatire|Miranda|VE|10.47|-66.54
Tanjung Pinang|Riau Islands|ID|0.92|104.46
Hougang New Town||SG|1.36|103.89
Baton Rouge|LA|US|30.44|-91.19
Criciuma|Santa Catarina|BR|-28.68|-49.37
Sosnowiec|Silesia|PL|50.29|19.1
Diez de Octubre|Havana|CU|23.09|-82.36
Turkistan|Turkistan|KZ|43.29|68.26
Klerksdorp|North West|ZA|-26.85|26.67
Upper West Side|NY|US|40.79|-73.98
Staryy Oskol|Belgorod Oblast|RU|51.3|37.85
Ageo|Saitama|JP|35.97|139.61
Gusau|Zamfara State|NG|12.17|6.66
Neue Neustadt|Saxony-Anhalt|DE|52.15|11.63
Kamyanske|Dnipropetrovsk|UA|48.52|34.61
Ashdod|Southern District|IL|31.79|34.65
Radom|Mazovia|PL|51.4|21.15
Paya Terubong|Penang|MY|5.37|100.28
Richmond|VA|US|37.55|-77.46
Chang-hua|Taiwan|TW|24.07|120.56
Changhua|Taiwan|TW|24.07|120.55
GJien Ban|Da Nang City|VN|15.89|108.25
Takarazuka|Hyogo|JP|34.8|135.36
Nzerekore|Nzerekore Region|GN|7.76|-8.82
Regina|Saskatchewan|CA|50.45|-104.62
Ca Mau|Ca Mau|VN|9.18|105.15
Shrirampur|West Bengal|IN|22.75|88.34
Fendou|Heilongjiang|CN|46.64|124.86
Pangkalpinang|Bangka-Belitung Islands|ID|-2.13|106.11
Huanggang|Guangdong|CN|23.68|117
Quthbullapur|Telangana|IN|17.5|78.46
Mubi|Adamawa|NG|10.27|13.27
Varamin|Tehran|IR|35.32|51.65
Sector 1|Bucharest|RO|44.49|26.05
Batu|East Java|ID|-7.87|112.53
Somerset West|Western Cape|ZA|-34.08|18.82
Luton|England|GB|51.88|-0.42
Ternopil|Ternopil|UA|49.55|25.59
Bitung|North Sulawesi|ID|1.44|125.13
Mymensingh|Mymensingh Division|BD|24.76|90.41
Blagoveshchensk|Amur Oblast|RU|50.28|127.53
Nadiad|Gujarat|IN|22.69|72.86
Kumba|South-West|CM|4.64|9.45
Kosice|Kosice Region|SK|48.71|21.26
Kremenchuk|Poltava|UA|49.06|33.4
Jingling|Hubei|CN|30.65|113.1
Nagercoil|Tamil Nadu|IN|8.18|77.43
Sucre|Chuquisaca Department|BO|-19.03|-65.26
Mutare|Manicaland|ZW|-18.97|32.67
Ota|Gunma|JP|36.3|139.37
Karawalnagar|Delhi|IN|28.73|77.27
Puerto Vallarta|Jalisco|MX|20.62|-105.23
Minamirinkan|Kanagawa|JP|35.5|139.44
Cork|Munster|IE|51.9|-8.47
Atsugi|Kanagawa|JP|35.44|139.37
Heihe|Heilongjiang|CN|50.24|127.49
Mango|Jharkhand|IN|22.83|86.22
Sinop|Mato Grosso|BR|-11.86|-55.5
Paramaribo|Paramaribo District|SR|5.87|-55.17
Klungkung|Bali|ID|-8.53|115.4
Narayanganj|Dhaka Division|BD|23.61|90.5
NIA Valencia|Northern Mindanao|PH|7.91|125.09
Tongchuanshi|Shaanxi|CN|35.07|109.08
Concepcion|Biobio|CL|-36.83|-73.05
Ramadi|Anbar|IQ|33.42|43.31
Paradise|NV|US|36.1|-115.15
Tacoma|WA|US|47.25|-122.44
Mainz|Rheinland-Pfalz|DE|49.98|8.28
Velikiy Novgorod|Novgorod Oblast|RU|58.52|31.27
Sungai Buloh|Selangor|MY|3.21|101.56
Puerto Princesa|Mimaropa|PH|9.74|118.74
Palhoca|Santa Catarina|BR|-27.65|-48.67
Xintai|Shandong|CN|35.9|117.75
El Tigre|Anzoategui|VE|8.89|-64.25
Haeju|South Hwanghae|KP|38.04|125.71
Formosa|Formosa|AR|-26.18|-58.17
Ikire|Osun State|NG|7.37|4.19
Jiexiu|Shanxi|CN|37.02|111.91
La Ceiba|Atlantida Department|HN|15.76|-86.78
Tilburg|North Brabant|NL|51.56|5.09
Ba Dinh|Hanoi|VN|21.04|105.83
Murwara|Madhya Pradesh|IN|23.84|80.39
Moshi|Kilimanjaro|TZ|-3.35|37.33
Kanchipuram|Tamil Nadu|IN|12.84|79.7
Sousse|Sousse Governorate|TN|35.83|10.64
Tulua|Valle del Cauca Department|CO|4.08|-76.2
Soyo|Zaire|AO|-6.13|12.37
Soc Trang|Can Tho City|VN|9.6|105.97
Kankan|Kankan Region|GN|10.39|-9.31
Shakhty|Rostov|RU|47.72|40.22
Mbarara|Western Region|UG|-0.6|30.65
Luziania|Goias|BR|-16.25|-47.95
Olongapo|Central Luzon|PH|14.83|120.28
Ibarra|Imbabura|EC|0.35|-78.12
Banja Luka|Srpska|BA|44.78|17.21
Rufisque est|Dakar|SN|14.72|-17.27
Neyshabur|Razavi Khorasan|IR|36.21|58.8
Saveh|Markazi|IR|35.02|50.36
Wuxue|Hubei|CN|29.85|115.55
Shevchenkivskyi|Kharkiv|UA|50.02|36.22
Chi Linh|Hai Phong|VN|21.07|106.32
Campeche|Campeche|MX|19.84|-90.52
Quan Ba|Ho Chi Minh City (HCMC)|VN|10.77|106.69
Singrauli|Madhya Pradesh|IN|24.2|82.68
Fuencarral-El Pardo|Madrid|ES|40.5|-3.73
Shevchenkivskyi|Kyiv City|UA|50.46|30.47
Mirzapur|Uttar Pradesh|IN|25.14|82.57
Oviedo|Asturias|ES|43.36|-5.84
Bandar Seri Alam|Johor|MY|1.5|103.88
Sorong|Southwest Papua|ID|-0.88|131.26
Messina|Sicily|IT|38.19|15.55
Dehiwala-Mount Lavinia|Western Province|LK|6.84|79.87
Kropyvnytskyi|Kirovohrad|UA|48.51|32.27
Kharagpur|West Bengal|IN|22.34|87.33
Kabinda|Lomami|CD|-6.14|24.48
Jacobabad|Sindh|PK|28.28|68.44
Tunduma|Songwe|TZ|-9.3|32.77
Binangonan|Calabarzon|PH|14.46|121.19
Oberhausen|North Rhine-Westphalia|DE|51.48|6.86
Chon Buri|Chon Buri|TH|13.36|100.98
Santa Luzia|Minas Gerais|BR|-19.77|-43.85
Prokop'yevsk|Kuzbass|RU|53.92|86.72
Samambaia|Federal District|BR|-15.88|-48.1
Erfurt|Thuringia|DE|50.98|11.04
Esmeraldas|Esmeraldas|EC|0.96|-79.65
Terrassa|Catalonia|ES|41.57|2.02
Barking|England|GB|51.53|0.08
Wuhai|Inner Mongolia|CN|39.68|106.82
Valparaiso de Goias|Goias|BR|-16.07|-47.98
Khuzdar|Balochistan|PK|27.81|66.61
Koutiala|Sikasso|ML|12.39|-5.47
Eluru|Andhra Pradesh|IN|16.71|81.1
Raniganj|Telangana|IN|17.43|78.49
San Pedro de Macoris|San Pedro de Macoris|DO|18.45|-69.31
Galati|Galati County|RO|45.44|28.05
Badalona|Catalonia|ES|41.45|2.25
Mokotow|Mazovia|PL|52.19|21.03
Taiping|Perak|MY|4.85|100.73
Yintai|Shaanxi|CN|35.12|109.1
Yamuna Nagar|Haryana|IN|30.13|77.28
Cabo de Santo Agostinho|Pernambuco|BR|-8.29|-35.03
Arakawa|Tokyo|JP|35.74|139.78
Jamaica|NY|US|40.69|-73.81
Buenavista|Mexico|MX|19.61|-99.17
Gilgit|Gilgit-Baltistan|PK|35.92|74.31
Rybinsk|Yaroslavl Oblast|RU|58.05|38.84
Santa Rosa|Calabarzon|PH|14.31|121.11
Sobral|Ceara|BR|-3.69|-40.35
Trondheim|Trondelag|NO|63.43|10.4
Raurkela Industrial Township|Odisha|IN|22.2|84.86
Porlamar|Nueva Esparta|VE|10.96|-63.87
San Bernardino|CA|US|34.11|-117.29
Ciudad Acuna|Coahuila|MX|29.32|-100.95
Oulu|North Ostrobothnia|FI|65.01|25.47
Bidar|Karnataka|IN|17.91|77.52
Vykhino-Zhulebino|Moscow|RU|55.7|37.81
Lutsk|Volyn|UA|50.76|25.35
San Cristobal de las Casas|Chiapas|MX|16.73|-92.64
Zelenograd|Moscow|RU|55.98|37.18
Archway|England|GB|51.57|-0.13
Wangsa Maju|Kuala Lumpur|MY|3.2|101.74
Salt Lake City|UT|US|40.76|-111.89
Biysk|Altai Krai|RU|52.53|85.2
Novi Sad|Vojvodina|RS|45.25|19.84
Jiutepec|Morelos|MX|18.88|-99.18
Longgang|Guangdong|CN|22.72|114.26
Monclova|Coahuila|MX|26.91|-101.42
Tan An|Tay Ninh|VN|10.54|106.41
Ma On Shan|Sha Tin|HK|22.41|114.24
Commonwealth|National Capital Region|PH|14.7|121.08
Huntsville|AL|US|34.73|-86.59
Jabaquara|Sao Paulo|BR|-23.65|-46.65
Ziguinchor|Ziguinchor|SN|12.57|-16.27
Passo Fundo|Rio Grande do Sul|BR|-28.26|-52.41
Kulob|Khatlon Province|TJ|37.91|69.78
Citeureup|West Java|ID|-6.49|106.88
Centralniy|St.-Petersburg|RU|59.93|30.36
Sa Dec|Dong Thap|VN|10.29|105.76
Kure|Hiroshima|JP|34.23|132.57
Shagamu|Ogun State|NG|6.85|3.65
Bnei Brak|Tel Aviv|IL|32.08|34.83
Khouribga|Beni Mellal-Khenifra|MA|32.88|-6.91
Yingtan|Jiangxi|CN|28.23|117
Des Moines|IA|US|41.6|-93.61
Cigli|Izmir Province|TR|38.5|27.07
Marcory|Abidjan Autonomous District|CI|5.31|-3.99
Gojra|Punjab|PK|31.15|72.68
Cartagena|Murcia|ES|37.6|-0.98
Quevedo|Los Rios|EC|-1.03|-79.46
Oakville|Ontario|CA|43.45|-79.68
Pasuruan|East Java|ID|-7.65|112.91
Nazarabad|Alborz Province|IR|35.95|50.61
Munger|Bihar|IN|25.37|86.47
Xilin Hot|Inner Mongolia|CN|43.97|116.03
Jerez de la Frontera|Andalusia|ES|36.69|-6.14
El Jadida|Casablanca-Settat|MA|33.26|-8.51
Zitong|Chongqing|CN|30.18|105.83
Loa Janan|East Kalimantan|ID|-0.58|117.1
Targu Mures|Mures County|RO|46.54|24.56
Fontana|CA|US|34.09|-117.44
Rancagua|O'Higgins Region|CL|-34.17|-70.74
Zhubei|Taiwan|TW|24.84|121.01
Mallawi|Minya|EG|27.73|30.84
Cape Coast|Central|GH|5.11|-1.25
Bukit Mertajam|Penang|MY|5.36|100.47
Lipa City|Calabarzon|PH|13.94|121.16
Lanus|Buenos Aires|AR|-34.71|-58.39
Luebeck|Schleswig-Holstein|DE|53.87|10.69
Luojiang|Sichuan|CN|31.3|104.5
Sepang|Selangor|MY|2.69|101.75
Coban|Alta Verapaz|GT|15.47|-90.37
Marica|Rio de Janeiro|BR|-22.92|-42.82
Cao Lanh|Dong Thap|VN|10.46|105.63
Isesaki|Gunma|JP|36.32|139.2
Sabadell|Catalonia|ES|41.54|2.11
Jaragua|Sao Paulo|BR|-23.44|-46.74
Taito|Tokyo|JP|35.71|139.78
Nandyal|Andhra Pradesh|IN|15.48|78.48
Santa Cruz de Tenerife|Canary Islands|ES|28.47|-16.25
Panchkula|Haryana|IN|30.69|76.85
Modesto|CA|US|37.64|-121
Panabo|Davao Region|PH|7.31|125.68
Lijiang|Yunnan|CN|26.87|100.22
Konibodom|Sughd|TJ|40.29|70.43
Hailar|Inner Mongolia|CN|49.2|119.7
Itaquera|Sao Paulo|BR|-23.53|-46.44
Kabankalan|Western Visayas|PH|9.98|122.81
Burhanpur|Madhya Pradesh|IN|21.31|76.23
Abha|'Asir Region|SA|18.22|42.51
Ternate|North Maluku|ID|0.79|127.38
Burgas|Burgas|BG|42.51|27.47
Pskov|Pskov Oblast|RU|57.82|28.33
Morvi|Gujarat|IN|22.82|70.84
Daliang|Guangdong|CN|22.84|113.25
Quilicura|Santiago Metropolitan|CL|-33.37|-70.71
Beni Mellal|Beni Mellal-Khenifra|MA|32.34|-6.35
Ashuganj City|Chittagong|BD|24.04|91.01
Sidi Bel Abbes|Sidi Bel Abbes|DZ|35.19|-0.63
Arroyo Naranjo|Havana|CU|23.04|-82.38
Jebel Ali|Dubai|AE|25|55.11
Bogra|Rajshahi Division|BD|24.85|89.37
Kostanay|Kostanay|KZ|53.21|63.62
Richmond|British Columbia|CA|49.17|-123.14
Rochester|NY|US|43.15|-77.62
Banjar|West Java|ID|-7.2|107.43
Novi Beograd|Central Serbia|RS|44.81|20.42
Kanggye|Chagang|KP|40.97|126.59
Chungju|North Chungcheong|KR|36.98|127.93
Anand|Gujarat|IN|22.55|72.96
Sao Leopoldo|Rio Grande do Sul|BR|-29.76|-51.15
Bade|Taiwan|TW|24.93|121.28
Oruro|Oruro|BO|-17.97|-67.09
Bachuan|Chongqing|CN|29.85|106.05
La Romana|La Romana|DO|18.42|-68.97
Aracatuba|Sao Paulo|BR|-21.21|-50.43
Shashamane|Oromiya|ET|7.2|38.6
Hangu|Tianjin|CN|39.25|117.79
Ongole|Andhra Pradesh|IN|15.5|80.04
Pamplona|Navarre|ES|42.82|-1.64
Maryvale|AZ|US|33.5|-112.18
Gangneung|Gangwon-do|KR|37.75|128.87
Portsmouth|England|GB|50.8|-1.09
Gandajika|Lomami|CD|-6.75|23.95
Gunan|Chongqing|CN|29.02|106.65
Phan Rang-Thap Cham|Khanh Hoa|VN|11.56|108.99
Ciputat|West Java|ID|-6.24|106.7
Kasangati|Central Region|UG|0.44|32.6
Arlington|VA|US|38.88|-77.1
Bishoftu|Oromiya|ET|8.75|38.98
Nishi-Tokyo-shi|Tokyo|JP|35.73|139.54
Changam-ch'on|South Hamgyong|KP|40.61|128.78
Bila Tserkva|Kyiv Oblast|UA|49.8|30.12
Oxnard|CA|US|34.2|-119.18
Ciampea|West Java|ID|-6.55|106.7
Hurghada|Red Sea|EG|27.26|33.81
Mostoles|Madrid|ES|40.32|-3.86
Columbus|GA|US|32.46|-84.99
Mantilla|Havana|CU|23.07|-82.34
Dosquebradas|Risaralda Department|CO|4.84|-75.67
Toledo|Central Visayas|PH|10.38|123.64
Turku|Southwest Finland|FI|60.45|22.27
Worcester|MA|US|42.26|-71.8
Pagadian|Zamboanga Peninsula|PH|7.83|123.44
Epworth|Harare|ZW|-17.89|31.15
San Felipe|Yaracuy|VE|10.34|-68.74
Dinajpur|Rangpur Division|BD|25.63|88.64
Hosapete|Karnataka|IN|15.27|76.39
Viet Yen|Bac Ninh|VN|21.27|106.13
Ifakara|Morogoro|TZ|-8.13|36.68
Sumbe|Kwanza Sul|AO|-11.21|13.84
Segou|Segou|ML|13.44|-6.26
Kon Tum|Quang Ngai|VN|14.35|108.01
Latacunga|Cotopaxi|EC|-0.93|-78.62
Nangloi Jat|Delhi|IN|28.68|77.07
Kishiwada|Osaka|JP|34.47|135.37
Yunjinghong|Yunnan|CN|22.01|100.8
Mdantsane|Eastern Cape|ZA|-32.93|27.78
Bobruysk|Mogilev|BY|53.15|29.21
Gorontalo|Gorontalo|ID|0.54|123.06
Itaim Paulista|Sao Paulo|BR|-23.5|-46.39
Qa'em Shahr|Mazandaran|IR|36.47|52.87
Shikarpur|Sindh|PK|27.96|68.64
Gongheyong|Guangdong|CN|22.76|113.79
Linz|Upper Austria|AT|48.31|14.29
Dhangadhi|Sudurpashchim Pradesh|NP|28.7|80.59
Nanchuan|Chongqing|CN|29.15|107.1
Cordoba|Veracruz|MX|18.88|-96.93
Bishan|Chongqing|CN|29.59|106.22
Biskra|Biskra|DZ|34.85|5.73
Xizhi|Taipei|TW|25.07|121.66
Yanghang|Shanghai|CN|31.37|121.44
Gaoping|Sichuan|CN|30.78|106.1
Trieste|Friuli Venezia Giulia|IT|45.65|13.78
Mpanda|Katavi|TZ|-6.34|31.07
Moreno Valley|CA|US|33.94|-117.23
Secunderabad|Telangana|IN|17.5|78.54
Punggol||SG|1.41|103.91
Sodo|South Ethiopia Regional State|ET|6.86|37.76
Nossa Senhora do Socorro|Sergipe|BR|-10.86|-37.13
Zliten|Misratah|LY|32.47|14.57
Padua|Veneto|IT|45.41|11.89
Karnaphuli|Chittagong|BD|22.69|92.23
Las Tunas|Las Tunas Province|CU|20.96|-76.95
Matsue|Shimane|JP|35.48|133.05
Bayamon|Bayamon|PR|18.4|-66.16
Gimpo-si|Gyeonggi-do|KR|37.62|126.71
Lauro de Freitas|Bahia|BR|-12.89|-38.33
Deoghar|Jharkhand|IN|24.49|86.7
Fianarantsoa|Upper Matsiatra|MG|-21.45|47.09
Vasyl'evsky Ostrov|St.-Petersburg|RU|59.94|30.25
Chandpur|Chittagong|BD|23.23|90.65
Atsiaman|Greater Accra|GH|5.7|-0.33
Bandundu Province|Kwilu|CD|-3.32|17.38
Osmaniye|Osmaniye|TR|37.07|36.25
Babol|Mazandaran|IR|36.55|52.68
Cabo San Lucas|Baja California Sur|MX|22.89|-109.91
Little Rock|AR|US|34.75|-92.29
Corlu|Tekirdag|TR|41.16|27.8
Madiun|East Java|ID|-7.63|111.52
Iringa|Iringa|TZ|-7.77|35.7
Debrecen|Hajdu-Bihar|HU|47.53|21.62
Chapra|Bihar|IN|25.78|84.75
Motijheel|Dhaka Division|BD|23.73|90.42
Barishal|Barisal Division|BD|22.7|90.37
Richmond Hill|Ontario|CA|43.87|-79.44
Fayetteville|NC|US|35.05|-78.88
Al Khums|Al Marqab|LY|32.65|14.26
Huntington Beach|CA|US|33.66|-118
Favoriten|Vienna|AT|48.16|16.38
Koronadal|Soccsksargen|PH|6.5|124.85
Geneva|Geneva|CH|46.2|6.15
Tallahassee|FL|US|30.44|-84.28
Swindon|England|GB|51.56|-1.78
Rengasdengklok|West Java|ID|-6.16|107.3
Rio Claro|Sao Paulo|BR|-22.41|-47.56
Cajamarca|Cajamarca Department|PE|-7.16|-78.5
Townsville|Queensland|AU|-19.27|146.81
Thanh Khe|Da Nang City|VN|16.07|108.19
La Pintana|Santiago Metropolitan|CL|-33.58|-70.63
Dasoguz|Dasoguz|TM|41.84|59.97
Yonkers|NY|US|40.93|-73.9
Glendale|CA|US|34.14|-118.26
Dadu|Sindh|PK|26.73|67.78
Arba Minch|South Ethiopia Regional State|ET|6.03|37.55
Petropavl|North Kazakhstan|KZ|54.87|69.15
Lhokseumawe|Aceh|ID|5.18|97.15
Cypress|TX|US|29.97|-95.7
Khandwa|Madhya Pradesh|IN|21.82|76.35
Aurora|IL|US|41.76|-88.32
Puri|Odisha|IN|19.8|85.82
Morena|Madhya Pradesh|IN|26.5|78
Nicosia|Nicosia|CY|35.17|33.35
Brescia|Lombardy|IT|45.54|10.21
Nasim Shahr|Tehran|IR|35.57|51.16
Nasimshahr|Tehran|IR|35.57|51.16
Ugep|Cross River State|NG|5.81|8.08
Kamina|Haut-Lomami|CD|-8.74|25
Yanbu|Medina Region|SA|24.09|38.06
Nagareyama|Chiba|JP|35.86|139.9
Charleroi|Wallonia|BE|50.41|4.44
Lang Son|Lang Son Province|VN|21.85|106.76
Talhar|Sindh|PK|24.88|68.81
Nyingchi|Tibet|CN|29.65|94.36
Yuen Long San Hui|Yuen Long|HK|22.43|114.03
Yuen Long|Yuen Long|HK|22.45|114.03
Sumedang|West Java|ID|-6.86|107.92
Gyanpur|Uttar Pradesh|IN|25.33|82.47
Az Zawiyah|Az Zawiyah|LY|32.76|12.73
Sale Al Jadida|Rabat-Sale-Kenitra|MA|34|-6.74
Bandar Sunway|Selangor|MY|3.07|101.61
Bandar Utama|Kuala Lumpur|MY|3.15|101.61
Bukit Jalil|Kuala Lumpur|MY|3.05|101.68
Chakwama|Jigawa State|NG|11.56|9.66
Qadirpur Ran|Punjab|PK|30.29|71.67
Dajal|Punjab|PK|29.56|70.38
Severnyy|Moscow|RU|55.94|37.55
El Dibir|Bari|SO|11.77|51.22
Beiliu|Guangxi|CN|22.71|110.35
Sirjan|Kerman|IR|29.45|55.68
Iquique|Tarapaca|CL|-20.21|-70.15
Thuan Thanh|Bac Ninh|VN|21.05|106.08
Balakovo|Saratov Oblast|RU|52.03|47.8
Armavir|Krasnodar Krai|RU|45|41.11
Jaragua do Sul|Santa Catarina|BR|-26.49|-49.07
Yachiyo|Chiba|JP|35.74|140.12
Saidpur|Rangpur Division|BD|25.78|88.89
Quan Bon|Ho Chi Minh City (HCMC)|VN|10.77|106.71
Arish|North Sinai|EG|31.13|33.8
Rawang|Selangor|MY|3.32|101.58
Dudley|England|GB|52.5|-2.08
Mushin|Lagos|NG|6.53|3.35
Yuzhno-Sakhalinsk|Sakhalin Oblast|RU|46.95|142.74
Hagen|North Rhine-Westphalia|DE|51.36|7.47
Salatiga|Central Java|ID|-7.33|110.49
Rio Grande|Rio Grande do Sul|BR|-32.03|-52.1
Guacara|Carabobo|VE|10.23|-67.88
Khuy|West Azerbaijan|IR|38.55|44.95
Gliwice|Silesia|PL|50.3|18.68
Changji|Xinjiang|CN|44.01|87.3
Kodaira|Tokyo|JP|35.73|139.49
Plano Piloto|Federal District|BR|-15.79|-47.88
Amarillo|TX|US|35.22|-101.83
Bulandshahr|Uttar Pradesh|IN|28.4|77.86
Lusail|Al Daayen|QA|25.42|51.51
Aberdeen|Scotland|GB|57.14|-2.1
Taranto|Apulia|IT|40.46|17.25
Capiata|Central Department|PY|-25.36|-57.45
Zango|Luanda|AO|-9.01|13.38
Duyun|Guizhou|CN|26.27|107.52
Naivasha|Nakuru County|KE|-0.71|36.43
Kaiyuan|Yunnan|CN|23.7|103.3
Cachoeiro de Itapemirim|Espirito Santo|BR|-20.85|-41.11
Rzeszow|Subcarpathia|PL|50.04|22
Lengshuijiang|Hunan|CN|27.69|111.43
Rostock|Mecklenburg-Vorpommern|DE|54.09|12.14
Parma|Emilia-Romagna|IT|44.8|10.33
Sibu|Sarawak|MY|2.3|111.82
Arnavutkoey|Istanbul|TR|41.18|28.74
Itami|Hyogo|JP|34.78|135.4
Mentougou|Beijing|CN|39.94|116.09
Bhind|Madhya Pradesh|IN|26.57|78.79
Akron|OH|US|41.08|-81.52
Talca|Maule Region|CL|-35.42|-71.65
Kassel|Hesse|DE|51.32|9.5
Ciudad Madero|Tamaulipas|MX|22.25|-97.84
Sawangan|West Java|ID|-6.4|106.77
Gemena|Sud-Ubangi|CD|3.26|19.77
Bhalswa Jahangirpur|Delhi|IN|28.74|77.17
Lushui|Yunnan|CN|25.82|98.86
Birjand|South Khorasan Province|IR|32.87|59.22
Torun|Kujawsko-Pomorskie|PL|53.01|18.6
Almeria|Andalusia|ES|36.84|-2.46
Jijiang|Chongqing|CN|29.29|106.25
Ahmadpur East|Punjab|PK|29.14|71.26
Huanuco|Huanuco Department|PE|-9.93|-76.24
Higashihiroshima|Hiroshima|JP|34.41|132.74
Izmit|Kocaeli|TR|40.76|29.93
Reims|Grand Est|FR|49.27|4.03
Hanfeng|Chongqing|CN|31.17|108.4
Vancouver|WA|US|45.64|-122.66
Birmingham|AL|US|33.52|-86.8
Itabuna|Bahia|BR|-14.79|-39.28
Laayoune||EH|27.14|-13.19
Khammam|Telangana|IN|17.25|80.14
Holon|Tel Aviv|IL|32.01|34.78
Middelburg|Mpumalanga|ZA|-25.78|29.46
Icheon-si|Gyeonggi-do|KR|37.28|127.44
Khirdalan|Abseron|AZ|40.45|49.76
Phra Pradaeng|Samut Prakan|TH|13.66|100.53
Moundou|Logone Occidental|TD|8.57|16.08
Sambhal|Uttar Pradesh|IN|28.58|78.57
Bhiwani|Haryana|IN|28.79|76.14
Engels|Saratov Oblast|RU|51.48|46.11
Ciudad Lazaro Cardenas|Michoacan|MX|17.96|-102.2
Mocuba|Zambezia Province|MZ|-16.84|36.99
Hetauda|Bagmati Province|NP|27.43|85.03
Durres|Durres County|AL|41.32|19.45
Fengcheng|Liaoning|CN|40.45|124.07
Suzuka|Mie|JP|34.88|136.58
Hub|Balochistan|PK|25.03|66.89
La Plata|Buenos Aires|AR|-34.92|-57.95
Janakpur|Madhesh|NP|26.73|85.93
Kamirenjaku|Tokyo|JP|35.69|139.55
Panvel|Maharashtra|IN|18.99|73.11
Peicheng|Jiangsu|CN|34.74|116.92
Maharagama|Western Province|LK|6.85|79.93
Montgomery|AL|US|32.37|-86.3
Liege|Wallonia|BE|50.63|5.57
Kumagaya|Saitama|JP|36.13|139.39
Guri-si|Gyeonggi-do|KR|37.6|127.14
Ambala|Haryana|IN|30.36|76.8
Grand Rapids|MI|US|42.96|-85.67
Prato|Tuscany|IT|43.88|11.1
Kumarapalayam|Tamil Nadu|IN|11.44|77.71
Butwal|Lumbini Province|NP|27.69|83.45
Dhirkot|Azad Kashmir|PK|34.04|73.58
Kayes|Kayes|ML|14.45|-11.44
Bontang|East Kalimantan|ID|0.13|117.49
Kafr ash Shaykh|Kafr el-Sheikh|EG|31.11|30.94
Tebessa|Tebessa|DZ|35.4|8.12
Kuala Kubu Baharu|Selangor|MY|3.56|101.66
Karuri|Kiambu County|KE|-1.18|36.76
Karuri|Murang'A|KE|-0.7|37.18
Maneah|Kindia|GN|9.73|-13.42
Severodvinsk|Arkhangelskaya|RU|64.56|39.83
Kowloon City Centre|Kowloon City|HK|22.33|114.19
Matuga|Kwale County|KE|-4.17|39.57
Duezce|Duzce|TR|40.84|31.16
Nnewi|Anambra|NG|6.02|6.92
Yamaguchi|Yamaguchi|JP|34.18|131.47
Alcala de Henares|Madrid|ES|40.48|-3.36
Basaksehir|Istanbul|TR|41.11|28.79
Ezhou|Hubei|CN|30.4|114.83
Zhengding|Hebei|CN|38.15|114.57
Bukan|West Azerbaijan|IR|36.52|46.21
Taguatinga|Federal District|BR|-15.83|-48.06
Braga|Braga|PT|41.55|-8.42
Garhi Khairo|Sindh|PK|28.06|67.98
Luanshya|Copperbelt|ZM|-13.14|28.42
Padalarang|West Java|ID|-6.84|107.47
Bang Khae|Bangkok|TH|13.69|100.41
Bago City|Western Visayas|PH|10.53|122.83
Yongchuan|Chongqing|CN|29.35|105.89
Uji|Kyoto|JP|34.89|135.8
Machilipatnam|Andhra Pradesh|IN|16.19|81.14
Hepu|Guangxi|CN|21.66|109.2
Aihui|Heilongjiang|CN|49.98|127.48
Hyesan|Yanggang-do|KP|41.4|128.18
Bayamo|Granma Province|CU|20.37|-76.64
Kielce|Swietokrzyskie|PL|50.87|20.63
Par Naogaon|Rajshahi Division|BD|24.8|88.95
Fuding|Fujian|CN|27.33|120.21
Castanhal|Para|BR|-1.29|-47.93
Cidade Tiradentes|Sao Paulo|BR|-23.58|-46.4
Zabrze|Silesia|PL|50.32|18.79
Hamilton|Waikato Region|NZ|-37.78|175.28
Bojnurd|North Khorasan|IR|37.47|57.33
Surulere|Lagos|NG|6.5|3.36
Humen|Guangdong|CN|22.82|113.67
Benfica|Luanda|AO|-8.94|13.16
Hat Yai|Songkhla|TH|7.01|100.48
Haicheng|Liaoning|CN|40.85|122.75
Curug|Banten|ID|-6.27|106.56
Barrancabermeja|Santander Department|CO|7.07|-73.85
Zlatoust|Chelyabinsk|RU|55.17|59.65
Mukono|Central Region|UG|0.35|32.76
Angren|Tashkent Region|UZ|41.02|70.14
Ciudad del Carmen|Campeche|MX|18.65|-91.83
Khairpur Mir's|Sindh|PK|27.53|68.76
Business Bay|Dubai|AE|25.19|55.27
Khujand|Sughd|TJ|40.28|69.62
Peoria|AZ|US|33.58|-112.24
Ashaiman|Greater Accra|GH|5.7|-0.03
Tanjungbalai|North Sumatra|ID|2.97|99.8
Providence|RI|US|41.82|-71.41
Mahesana|Gujarat|IN|23.6|72.38
Knoxville|TN|US|35.96|-83.92
Rangel|Luanda|AO|-8.83|13.26
Fuenlabrada|Madrid|ES|40.28|-3.79
Hino|Tokyo|JP|35.67|139.4
Jhelum|Punjab|PK|32.93|73.73
Mahbubnagar|Telangana|IN|16.74|77.99
Beipiao|Liaoning|CN|41.79|120.78
Pak Kret|Nonthaburi|TH|13.91|100.5
Cam Pha|Quang Ninh|VN|21.01|107.27
Al Fallujah|Anbar|IQ|33.35|43.79
Jinshanlu|Xinjiang|CN|47.85|88.13
Ise-Ekiti|Ekiti State|NG|7.46|5.42
Nova Friburgo|Rio de Janeiro|BR|-22.28|-42.53
Guarapuava|Parana|BR|-25.39|-51.47
Kofu|Yamanashi|JP|35.67|138.57
Numazu|Shizuoka|JP|35.1|138.87
Santa Barbara d'Oeste|Sao Paulo|BR|-22.75|-47.41
Joetsu|Niigata|JP|37.15|138.24
Planaltina|Federal District|BR|-15.62|-47.65
Sunrise Manor|NV|US|36.21|-115.07
Sambalpur|Odisha|IN|21.47|83.98
Syzran|Samara Oblast|RU|53.16|48.47
Danshui|Taipei|TW|25.17|121.44
Bytom|Silesia|PL|50.35|18.93
Mwene-Ditu|Lomami|CD|-7.01|23.45
Ilheus|Bahia|BR|-14.8|-39.03
Panalanoy|Eastern Visayas|PH|11.25|125.01
Ciudad de Las Heras|Mendoza|AR|-32.85|-68.84
Guixi|Chongqing|CN|30.33|107.35
Odawara|Kanagawa|JP|35.26|139.16
Labuan Bajo|East Nusa Tenggara|ID|-8.5|119.89
Anjo|Aichi|JP|34.96|137.08
Boyeros|Havana|CU|23.01|-82.4
George|Western Cape|ZA|-33.96|22.46
Tottori-shi|Tottori|JP|35.5|134.23
Leganes|Madrid|ES|40.33|-3.76
Acarigua|Portuguesa|VE|9.55|-69.2
Hosa'ina|Central Ethiopia Regional State|ET|7.55|37.85
Sai Mai|Bangkok|TH|13.92|100.65
Yawnghwe|Shan State|MM|20.66|96.93
Mabalacat City|Central Luzon|PH|15.22|120.57
Riohacha|La Guajira Department|CO|11.54|-72.91
Laizhou|Shandong|CN|37.18|119.94
Pilsen|Plzen Region|CZ|49.75|13.38
Grand Prairie|TX|US|32.75|-97
Sorsogon|Bicol Region|PH|12.97|123.99
Ait Melloul|Souss-Massa|MA|30.34|-9.5
Sutton|England|GB|51.35|-0.2
Shreveport|LA|US|32.53|-93.75
Choa Chu Kang New Town||SG|1.38|103.75
Getafe|Madrid|ES|40.31|-3.73
Quan Nam|Ho Chi Minh City (HCMC)|VN|10.76|106.67
Bhusawal|Maharashtra|IN|21.04|75.79
Miraflores|Lima region|PE|-12.11|-77.03
Alvorada|Rio Grande do Sul|BR|-30|-51.08
Chilpancingo|Guerrero|MX|17.55|-99.5
Donaustadt|Vienna|AT|48.23|16.46
Pinar del Rio|Pinar del Rio|CU|22.42|-83.7
Huixing|Chongqing|CN|29.68|106.61
Kirikkale|Kirikkale|TR|39.85|33.51
Batumi|Adjara|GE|41.64|41.63
Burlington|Ontario|CA|43.39|-79.84
Pabna|Rajshahi Division|BD|24.01|89.24
Brownsville|TX|US|25.9|-97.5
Changyuan|Chongqing|CN|29.4|105.59
Cienfuegos|Cienfuegos Province|CU|22.15|-80.45
Beersheba|Southern District|IL|31.25|34.79
Dixinn|Conakry|GN|9.55|-13.67
El Oued|El Oued|DZ|33.36|6.86
Overland Park|KS|US|38.98|-94.67
Raebareli|Uttar Pradesh|IN|26.23|81.23
Shangri-La|Yunnan|CN|27.83|99.71
Springs|Gauteng|ZA|-26.25|28.4
Newport News|VA|US|36.98|-76.43
Yangcheng|Chongqing|CN|30|106.26
Mopti|Mopti|ML|14.48|-4.18
Khuraybat as Suq|Amman|JO|31.88|35.92
Zawiya|Az Zawiyah|LY|32.75|12.73
Zamora de Hidalgo|Michoacan|MX|19.98|-102.29
Haridwar|Uttarakhand|IN|29.95|78.16
Ad-Damazin|Blue Nile|SD|11.79|34.36
Dunhuang|Gansu|CN|40.17|94.68
Jing'an|Guangdong|CN|22.21|113.29
Le Havre|Normandy|FR|49.49|0.11
Verhunskyi|Luhansk|UA|48.59|39.37
Phusro|Jharkhand|IN|23.76|86.01
San Sebastian|Basque Country|ES|43.31|-1.97
Poza Rica de Hidalgo|Veracruz|MX|20.53|-97.46
Bilbeis|Sharqia|EG|30.42|31.56
Roxas City|Western Visayas|PH|11.59|122.75
Paris 20 Menilmontant|Ile-de-France|FR|48.86|2.4
Kuetahya|Kuetahya|TR|39.42|29.98
Palopo|South Sulawesi|ID|-2.99|120.2
Potsdam|Brandenburg|DE|52.4|13.07
Modena|Emilia-Romagna|IT|44.65|10.93
Bolu|Bolu|TR|40.74|31.61
Toyokawa|Aichi|JP|34.82|137.4
Adoni|Andhra Pradesh|IN|15.63|77.27
Izumi|Osaka|JP|34.48|135.43
Santa Anita - Los Ficus|Lima region|PE|-12.05|-76.97
Paltan|Dhaka Division|BD|23.74|90.41
Ivory Park|Gauteng|ZA|-26|28.19
Al Qamishli|Al-Hasakah|SY|37.05|41.23
Abakan|Khakasiya Republic|RU|53.72|91.43
Pemalang|Central Java|ID|-6.89|109.38
Breda|North Brabant|NL|51.59|4.78
Langsa|Aceh|ID|4.47|97.97
Vinh Chau|Can Tho City|VN|9.32|105.98
Baishan|Jilin|CN|41.94|126.42
Sujangarh|Rajasthan|IN|27.7|74.47
Linhares|Espirito Santo|BR|-19.39|-40.07
Castello de la Plana|Valencia|ES|39.99|-0.05
Tachikawa|Tokyo|JP|35.71|139.42
Cergy-Pontoise|Ile-de-France|FR|49.04|2.08
Unaizah|Al-Qassim Region|SA|26.1|44
Mobile|AL|US|30.69|-88.04
St Helens|England|GB|53.45|-2.73
Fort Lauderdale|FL|US|26.12|-80.14
Lembang|West Java|ID|-6.81|107.62
Paris 18 Buttes-Montmartre|Ile-de-France|FR|48.89|2.34
Sants-Montjuic|Catalonia|ES|41.37|2.15
Oradea|Bihor County|RO|47.05|21.92
Araguaina|Tocantins|BR|-7.19|-48.21
Saarbruecken|Saarland|DE|49.23|7.01
Bunda|Mara|TZ|-2.02|33.87
Skikda|Skikda|DZ|36.88|6.91
Kyivskyi|Kharkiv|UA|50.04|36.29
Tirmiz|Surxondaryo Region|UZ|37.22|67.28
Singosari|East Java|ID|-7.89|112.67
Porto Seguro|Bahia|BR|-16.45|-39.06
Cua|Miranda|VE|10.16|-66.88
Sirsa|Haryana|IN|29.53|75.03
Kamensk-Ural'skiy|Sverdlovsk Oblast|RU|56.41|61.93
Cidade Dutra|Sao Paulo|BR|-23.73|-46.7
Reggio Calabria|Calabria|IT|38.11|15.66
Dinapur Nizamat|Bihar|IN|25.64|85.05
Santa Clarita|CA|US|34.39|-118.54
Carletonville|Gauteng|ZA|-26.36|27.4
Dubreka|Kindia|GN|9.79|-13.52
Metro|Lampung|ID|-5.11|105.31
Banha|Qalyubia|EG|30.46|31.18
Bahraigh|Uttar Pradesh|IN|27.57|81.59
Ash Shatrah|Dhi Qar|IQ|31.41|46.17
Quarto Oggiaro|Lombardy|IT|45.51|9.14
Tsing Yi Town|Kwai Tsing District|HK|22.35|114.1
Monywa|Sagaing Region|MM|22.11|95.14
Dessalines|Artibonite|HT|19.26|-72.52
Mwala|Machakos County|KE|-1.35|37.45
Karaikkudi|Tamil Nadu|IN|10.07|78.77
Araure|Portuguesa|VE|9.58|-69.24
Barra Mansa|Rio de Janeiro|BR|-22.54|-44.17
Sultan Pur Majra|Delhi|IN|28.69|77.08
Zhenping|Henan|CN|33.03|112.23
Anda|Heilongjiang|CN|46.45|125.3
Paris 13 Gobelins|Ile-de-France|FR|48.83|2.36
Petropavlovsk-Kamchatsky|Kamchatka|RU|53.06|158.63
Wadi as Sir|Amman|JO|31.95|35.82
Fardis|Tehran|IR|35.76|51
Chattanooga|TN|US|35.05|-85.31
Guna|Madhya Pradesh|IN|24.65|77.31
Odense|South Denmark|DK|55.4|10.39
Sacaba|Cochabamba|BO|-17.4|-66.04
Quetzaltenango|Quetzaltenango|GT|14.84|-91.52
Gongzhuling|Jilin|CN|43.5|124.82
Chandannagar|West Bengal|IN|22.86|88.37
Baharampur|West Bengal|IN|24.1|88.25
Ploiesti|Prahova|RO|44.95|26.02
Berazategui|Buenos Aires|AR|-34.77|-58.21
Shahuwadi|Maharashtra|IN|16.91|73.95
Madanapalle|Andhra Pradesh|IN|13.55|78.5
Tangail|Dhaka Division|BD|24.25|89.92
Shulin|Taipei|TW|24.99|121.42
Edirne|Edirne|TR|41.68|26.56
Nepean|Ontario|CA|45.34|-75.72
Pingwu County|Sichuan|CN|32.41|104.53
Kyaukpyu|Rakhine|MM|19.43|93.55
Yasenevo|Moscow|RU|55.61|37.52
Phuc Yen|Phu Tho|VN|21.24|105.7
Shivpuri|Madhya Pradesh|IN|25.42|77.66
Yangju|Gyeonggi-do|KR|37.83|127.06
Borshchahivka|Kyiv City|UA|50.43|30.39
Praga Poludnie|Mazovia|PL|52.24|21.09
Pirituba|Sao Paulo|BR|-23.49|-46.73
Kasama|Northern Province|ZM|-10.21|31.18
Surendranagar|Gujarat|IN|22.73|71.65
Alexandra|Gauteng|ZA|-26.11|28.1
Obuase|Ashanti|GH|6.2|-1.67
Desnyanskyi|Chernihiv Oblast|UA|51.51|31.32
Novozavodskyi|Chernihiv Oblast|UA|51.49|31.26
Ibirite|Minas Gerais|BR|-20.02|-44.06
Tsentralnyi|Donetsk|UA|47.1|37.55
Legaspi|Bicol Region|PH|13.14|123.74
Podolsk|Moscow Oblast|RU|55.42|37.55
Purwakarta|West Java|ID|-6.56|107.44
Jizzax|Jizzakh Region|UZ|40.13|67.83
Ferraz de Vasconcelos|Sao Paulo|BR|-23.54|-46.37
Ila Orangun|Osun State|NG|8.02|4.9
Thi Tran GJai Tu|Thai Nguyen|VN|21.63|105.64
Neyveli|Tamil Nadu|IN|11.61|79.5
Angra dos Reis|Rio de Janeiro|BR|-23.01|-44.32
Qianjiang|Hubei|CN|30.42|112.89
Hamm|North Rhine-Westphalia|DE|51.68|7.82
Si Racha|Chon Buri|TH|13.17|100.93
Tiaret|Tiaret|DZ|35.37|1.32
La Rioja|La Rioja|AR|-29.41|-66.86
Silchar|Assam|IN|24.83|92.8
Amadora|Lisbon|PT|38.75|-9.23
Cuautitlan|Mexico|MX|19.67|-99.18
Ipswich|England|GB|52.06|1.16
Njeru|Central Region|UG|0.44|33.18
Toliara|Atsimo-Andrefana|MG|-23.35|43.67
Paris 19 Buttes-Chaumont|Ile-de-France|FR|48.88|2.38
Saki|Oyo State|NG|8.67|3.39
Chlef|Chlef|DZ|36.17|1.33
Fontanar|Havana|CU|23.02|-82.41
Seogwipo|Jeju-do|KR|33.25|126.56
Concepcion|Central Luzon|PH|15.33|120.66
East Flatbush|NY|US|40.65|-73.93
Spring Valley|NV|US|36.11|-115.25
Livingstone|Southern Province|ZM|-17.84|25.85
Potchefstroom|North West|ZA|-26.72|27.1
Santa Rosa|CA|US|38.44|-122.71
Ciudad Camilo Cienfuegos|Havana|CU|23.16|-82.33
Paris 13e Arrondissement|Ile-de-France|FR|48.83|2.36
Sambizanga|Luanda|AO|-8.79|13.28
Proddatur|Andhra Pradesh|IN|14.75|78.55
Sittwe|Rakhine|MM|20.15|92.9
Dundo|Luanda Norte|AO|-7.37|20.82
Basel|Basel-City|CH|47.56|7.57
Meiktila|Mandalay Region|MM|20.88|95.86
Gulu|Northern Region|UG|2.77|32.3
Nijmegen|Gelderland|NL|51.84|5.85
Idku|Beheira|EG|31.31|30.3
Uppsala|Uppsala|SE|59.86|17.64
Hugli|West Bengal|IN|22.91|88.4
Hashtsal|Delhi|IN|28.63|77.06
Braganca Paulista|Sao Paulo|BR|-22.95|-46.54
Teresopolis|Rio de Janeiro|BR|-22.42|-42.98
San Luis Rio Colorado|Sonora|MX|32.46|-114.77
Santa Ana|Santa Ana Department|SV|13.99|-89.56
Eugene|OR|US|44.05|-123.09
Nador|Oriental|MA|35.17|-2.93
Al Muharraq|Muharraq|BH|26.26|50.61
Bielsko-Biala|Silesia|PL|49.82|19.05
Marsa Matruh|Matruh|EG|31.35|27.24
Almere Stad|Flevoland|NL|52.37|5.21
Burgos|Castille and Leon|ES|42.34|-3.7
Gijang|Busan|KR|35.24|129.21
Lander|Miranda|VE|10.18|-66.7
Saint-Etienne|Auvergne-Rhone-Alpes|FR|45.43|4.39
Amroha|Uttar Pradesh|IN|28.9|78.47
Narashino|Chiba|JP|35.68|140.04
Bejaia|Bejaia|DZ|36.76|5.08
Zhenzhou|Jiangsu|CN|32.28|119.17
Tempe|AZ|US|33.41|-111.91
Xindi|Hubei|CN|29.82|113.47
Oceanside|CA|US|33.2|-117.38
Bella Vista|Nacional|DO|18.46|-69.95
Fengcheng|Chongqing|CN|29.83|107.06
Salem|OR|US|44.94|-123.04
Wigan|England|GB|53.54|-2.64
Garden Grove|CA|US|33.77|-117.94
Karaman|Karaman|TR|37.18|33.22
Oshawa|Ontario|CA|43.9|-78.85
Siverek|Sanliurfa|TR|37.76|39.32
Rancho Cucamonga|CA|US|34.11|-117.59
Cape Coral|FL|US|26.56|-81.95
Tan Chau|An Giang|VN|10.8|105.24
Teluknaga|West Java|ID|-6.1|106.64
Jiutai|Jilin|CN|44.15|125.83
Chhindwara|Madhya Pradesh|IN|22.06|78.94
Itu|Sao Paulo|BR|-23.26|-47.3
Senador Canedo|Goias|BR|-16.71|-49.09
Khanaqin|Diyala|IQ|34.35|45.39
Naga|Bicol Region|PH|13.62|123.18
Tomakomai|Hokkaido|JP|42.64|141.6
Tambaram|Tamil Nadu|IN|12.92|80.13
San Miguel de Allende|Guanajuato|MX|20.92|-100.74
Cianjur|West Java|ID|-6.82|107.14
Pamulang|West Java|ID|-6.34|106.74
Hitachi|Ibaraki|JP|36.6|140.65
Timon|Maranhao|BR|-5.09|-42.84
Bhetia|Jharkhand|IN|22.79|86.14
Pathankot|Punjab|IN|32.27|75.65
Tando Adam|Sindh|PK|25.77|68.66
Badlapur|Maharashtra|IN|19.16|73.27
Cikupa|West Java|ID|-6.24|106.51
Puerto Cabello|Carabobo|VE|10.47|-68.01
Latkrabang|Bangkok|TH|13.73|100.75
Sakura|Chiba|JP|35.72|140.23
Ube|Yamaguchi|JP|33.94|131.25
Daule|Guayas|EC|-1.86|-79.98
Bayji|Salah ad Din|IQ|34.93|43.49
Cuddalore|Tamil Nadu|IN|11.76|79.77
Santander|Cantabria|ES|43.47|-3.8
Tlemcen|Tlemcen|DZ|34.88|-1.31
Shimla|Himachal Pradesh|IN|31.1|77.17
Shahin Shahr|Isfahan|IR|32.86|51.55
Croydon|England|GB|51.38|-0.1
Myeik|Tanintharyi Region|MM|12.44|98.6
East New York|NY|US|40.67|-73.88
Khan Yunis|Gaza Strip|PS|31.34|34.31
Dharan|Koshi|NP|26.81|87.28
Muelheim|North Rhine-Westphalia|DE|51.43|6.88
Albacete|Castille-La Mancha|ES|38.99|-1.86
Bata|Litoral|GQ|1.86|9.77
Kamakura|Kanagawa|JP|35.31|139.55
Chicoloapan|Mexico|MX|19.42|-98.9
Gadag-Betageri|Karnataka|IN|15.42|75.62
Licheng|Guangdong|CN|23.3|113.82
Izumo|Shimane|JP|35.37|132.77
Sao Caetano do Sul|Sao Paulo|BR|-23.62|-46.55
Pindamonhangaba|Sao Paulo|BR|-22.92|-45.46
Gadag|Karnataka|IN|15.43|75.63
Ongata Rongai|Kajiado County|KE|-1.4|36.76
Lang'ata|Nairobi County|KE|-1.37|36.73
Tunja|Boyaca|CO|5.54|-73.36
Lages|Santa Catarina|BR|-27.82|-50.33
Quillacollo|Cochabamba|BO|-17.39|-66.28
Alcorcon|Madrid|ES|40.35|-3.82
Gisenyi|Western Province|RW|-1.7|29.26
Pocos de Caldas|Minas Gerais|BR|-21.79|-46.56
Isparta|Isparta|TR|37.76|30.55
Warrington|England|GB|53.39|-2.58
Klaipeda|Klaipeda County|LT|55.71|21.14
Walsall|England|GB|52.59|-1.98
Herne|North Rhine-Westphalia|DE|51.54|7.23
Lyublino|Moscow|RU|55.68|37.76
Mansfield|England|GB|53.13|-1.2
Reggio nell'Emilia|Emilia-Romagna|IT|44.7|10.63
Barreiras|Bahia|BR|-12.15|-44.99
Keng Tung|Shan State|MM|21.63|99.93
Sioux Falls|SD|US|43.54|-96.73
Prizren|Prizren|XK|42.21|20.74
Dongling|Liaoning|CN|41.81|123.58
Ungaran|Central Java|ID|-7.14|110.41
Urayasu|Chiba|JP|35.66|139.9
Long Khanh|Dong Nai|VN|10.93|107.25
Dagupan|Ilocos|PH|16.04|120.33
Ontario|CA|US|34.06|-117.65
Watthana|Bangkok|TH|13.73|100.59
Veraval|Gujarat|IN|20.91|70.37
Navsari|Gujarat|IN|20.94|72.92
Imabari|Ehime|JP|34.07|133
Mansa|Luapula Province|ZM|-11.2|28.89
Fort Collins|CO|US|40.59|-105.08
Bao Loc|Lam Dong|VN|11.55|107.81
Kulim|Kedah|MY|5.36|100.56
Oshodi|Lagos|NG|6.56|3.34
Ramat Gan|Tel Aviv|IL|32.08|34.81
Bahadurgarh|Haryana|IN|28.69|76.94
Haldia|West Bengal|IN|22.06|88.11
Temirtau|Karaganda|KZ|50.05|72.95
East Helsinki|Uusimaa|FI|60.21|25.08
Parnaiba|Piaui|BR|-2.9|-41.78
Carolina|Carolina|PR|18.38|-65.96
Raiganj|West Bengal|IN|25.61|88.12
Malayer|Hamadan Province|IR|34.3|48.82
Springfield|MO|US|37.22|-93.3
Sunderland|England|GB|54.9|-1.38
Takaoka|Toyama|JP|36.75|137.02
Baranovichi|Brest|BY|53.13|26.01
Malda|West Bengal|IN|25|88.15
Guadalupe|Zacatecas|MX|22.75|-102.52
Nishio|Aichi|JP|34.87|137.05
San Luis|San Luis|AR|-33.29|-66.32
Ouargla|Ouargla|DZ|31.95|5.33
Olsztyn|Warmia-Masuria|PL|53.78|20.49
Kipushi|Haut-Katanga|CD|-11.76|27.25
Yuen Long Kau Hui|Yuen Long|HK|22.45|114.03
Jaunpur|Uttar Pradesh|IN|25.75|82.69
Khlong Sam Wa|Bangkok|TH|13.87|100.74
Harburg|Hamburg|DE|53.46|9.98
Chuo|Tokyo|JP|35.67|139.78
Mufulira|Copperbelt|ZM|-12.55|28.24
Deoli|Delhi|IN|28.5|77.23
Jaffna|Northern Province|LK|9.67|80.01
Arad|Arad County|RO|46.18|21.32
Chetumal|Quintana Roo|MX|18.52|-88.3
Bharuch|Gujarat|IN|21.69|72.98
Gurue|Zambezia Province|MZ|-15.47|36.98
San Miguel|Buenos Aires|AR|-34.54|-58.71
Hirosaki|Aomori|JP|40.59|140.47
Chalco|Mexico|MX|19.26|-98.9
Toulon|Provence-Alpes-Cote d'Azur|FR|43.12|5.93
Vila Andrade|Sao Paulo|BR|-23.63|-46.73
Hoshiarpur|Punjab|IN|31.54|75.91
Calabozo|Guarico|VE|8.92|-67.43
Jabalya|Gaza Strip|PS|31.53|34.48
Cuauhtemoc|Chihuahua|MX|28.41|-106.87
Araraquara|Sao Paulo|BR|-21.79|-48.18
Yopal|Casanare Department|CO|5.34|-72.39
Ituzaingo|Corrientes|AR|-27.59|-56.69
Piranshahr|West Azerbaijan|IR|36.7|45.14
Mahabad|West Azerbaijan|IR|36.76|45.72
Florencia|Caqueta|CO|1.62|-75.6
Tay Ho|Hanoi|VN|21.07|105.81
Moratuwa|Western Province|LK|6.77|79.88
Angers|Pays de la Loire|FR|47.47|-0.55
Ilford|England|GB|51.56|0.07
Hasilpur|Punjab|PK|29.69|72.55
Rio das Ostras|Rio de Janeiro|BR|-22.53|-41.95
Horta-Guinardo|Catalonia|ES|41.42|2.17
Patra|West Greece|GR|38.25|21.74
Rutchenkivskyi|Donetsk|UA|47.98|37.7
GJong Xoai|Dong Nai|VN|11.53|106.88
Jamalpur|Mymensingh Division|BD|24.92|89.95
Kushiro|Hokkaido|JP|42.98|144.37
Berezniki|Perm Krai|RU|59.41|56.82
Awka|Anambra|NG|6.21|7.07
Volgodonsk|Rostov|RU|47.51|42.15
Hollywood|CA|US|34.1|-118.33
Oyama|Tochigi|JP|36.3|139.8
Ijero-Ekiti|Ekiti State|NG|7.82|5.07
Jind|Haryana|IN|29.32|76.32
Miass|Chelyabinsk|RU|55.05|60.11
Fortechnyi|Kirovohrad|UA|48.5|32.25
Tuguegarao|Cagayan Valley|PH|17.62|121.72
Carupano|Sucre|VE|10.67|-63.25
Kumbakonam|Tamil Nadu|IN|10.96|79.39
Plumbon|West Java|ID|-6.71|108.47
Darmstadt|Hesse|DE|49.87|8.65
Mary|Mary|TM|37.59|61.83
Novocherkassk|Rostov|RU|47.42|40.09
Elk Grove|CA|US|38.41|-121.37
Mohali|Punjab|IN|30.68|76.72
Sampit|Central Kalimantan|ID|-2.53|112.95
Clarksville|TN|US|36.53|-87.36
Wan Chai|Wan Chai|HK|22.28|114.17
Linkoeping|OEstergoetland|SE|58.41|15.62
Iwata|Shizuoka|JP|34.7|137.85
Kamalia|Punjab|PK|30.73|72.65
Pembroke Pines|FL|US|26|-80.22
Maicao|La Guajira Department|CO|11.38|-72.24
Obihiro|Hokkaido|JP|42.92|143.2
Fatehpur|Uttar Pradesh|IN|25.93|80.81
Osnabrueck|Lower Saxony|DE|52.27|8.05
Calama|Antofagasta|CL|-22.46|-68.92
Nou Barris|Catalonia|ES|41.44|2.18
Nepalgunj|Lumbini Province|NP|28.05|81.62
Comitan|Chiapas|MX|16.24|-92.14
Ocumare del Tuy|Miranda|VE|10.12|-66.78
Niiza|Saitama|JP|35.82|139.56
Greater Sudbury|Ontario|CA|46.49|-80.99
Khobar|Eastern Province|SA|26.28|50.21
Songcheng|Fujian|CN|26.88|120
Deer Valley|AZ|US|33.68|-112.13
Bang Khun Thian|Bangkok|TH|13.66|100.43
Murfreesboro|TN|US|35.85|-86.39
Bushehr|Bushehr|IR|28.97|50.84
Dar Bouazza|Casablanca-Settat|MA|33.52|-7.82
Tonk|Rajasthan|IN|26.17|75.79
Saqqez|Kurdistan Province|IR|36.25|46.27
Bechar|Bechar|DZ|31.62|-2.22
Tam Ky|Da Nang City|VN|15.57|108.47
Goelbasi|Ankara|TR|39.79|32.81
Francisco Morato|Sao Paulo|BR|-23.28|-46.75
Bima|West Nusa Tenggara|ID|-8.46|118.73
Mu-se|Shan State|MM|24|97.9
Udupi|Karnataka|IN|13.33|74.75
Shahrud|Semnan|IR|36.42|54.98
Banjaran|West Java|ID|-7.05|107.59
Thenali|Andhra Pradesh|IN|16.24|80.64
Mthatha|Eastern Cape|ZA|-31.59|28.78
Hengshan|Heilongjiang|CN|45.21|130.9
Slough|England|GB|51.51|-0.6
Bocoio|Benguela|AO|-12.47|14.14
Neukoelln|State of Berlin|DE|52.48|13.43
Port Saint Lucie|FL|US|27.29|-80.35
Sitapur|Uttar Pradesh|IN|27.56|80.68
Alandur|Tamil Nadu|IN|13|80.21
Zenica|Federation of B&H|BA|44.2|17.9
Lajeado|Sao Paulo|BR|-23.53|-46.41
Solingen|North Rhine-Westphalia|DE|51.17|7.08
Itapetininga|Sao Paulo|BR|-23.59|-48.05
Dong Ha|Quang Tri|VN|16.82|107.1
Corona|CA|US|33.88|-117.57
Hawalli|Hawalli|KW|29.33|48.03
Musoma|Mara|TZ|-1.5|33.8
Inisa|Osun State|NG|7.85|4.33
Nazran|Ingushetiya Republic|RU|43.23|44.77
Ilagan|Cagayan Valley|PH|17.15|121.89
Port-Gentil|Ogooue-Maritime|GA|-0.72|8.78
Bhadravati|Karnataka|IN|13.85|75.71
Santana de Parnaiba|Sao Paulo|BR|-23.44|-46.92
Hadano|Kanagawa|JP|35.37|139.22
Piraeus|Attica|GR|37.94|23.65
Vapi|Gujarat|IN|20.37|72.9
Bournemouth|England|GB|50.72|-1.88
Pedreira|Sao Paulo|BR|-23.71|-46.65
Sidon|South Governorate|LB|33.56|35.37
Caxias|Maranhao|BR|-4.86|-43.36
'Ibri|Ad Dhahirah|OM|23.23|56.52
Jomvu|Mombasa County|KE|-3.99|39.61
Garissa|Garissa County|KE|-0.45|39.65
Moga|Punjab|IN|30.81|75.17
Peterborough|England|GB|52.57|-0.25
Piedecuesta|Santander Department|CO|6.99|-73.05
Tongzhou|Beijing|CN|39.9|116.66
Ludwigshafen am Rhein|Rheinland-Pfalz|DE|49.48|8.45
Lat Krabang|Bangkok|TH|13.72|100.78
Salalah|Dhofar|OM|17.02|54.09
Bueyuekcekmece|Istanbul|TR|41.02|28.59
Raj-Nandgaon|Chhattisgarh|IN|21.1|81.03
Aydin|Aydin|TR|37.85|27.84
Envigado|Antioquia|CO|6.18|-75.59
Itapecerica da Serra|Sao Paulo|BR|-23.72|-46.85
Al-Junaynah|Western Darfur|SD|13.45|22.45
Anbu|Guangdong|CN|23.45|116.68
McKinney|TX|US|33.2|-96.62
Mostaganem|Mostaganem|DZ|35.93|0.09
Chirchiq|Tashkent Region|UZ|41.47|69.58
Bandar-e Mahshahr|Khuzestan|IR|30.56|49.19
Floridsdorf|Vienna|AT|48.25|16.4
Leverkusen|North Rhine-Westphalia|DE|51.03|6.98
Pandi|Central Luzon|PH|14.87|120.96
Capas|Central Luzon|PH|15.33|120.59
Ning'er|Yunnan|CN|23.04|101.04
Haarlem|North Holland|NL|52.38|4.64
Arnhem|Gelderland|NL|51.98|5.91
Nkongsamba|Littoral|CM|4.95|9.94
El Vigia|Merida|VE|8.61|-71.66
Araucaria|Parana|BR|-25.59|-49.41
Robertsonpet|Karnataka|IN|12.96|78.28
Kitale|Trans Nzoia|KE|1.02|35.01
Suleja|Niger State|NG|9.18|7.18
Pouso Alegre|Minas Gerais|BR|-22.23|-45.94
Taza|Fes-Meknes|MA|34.21|-4.01
Oxford|England|GB|51.75|-1.26
Al Matariyah|Dakahlia|EG|31.18|32.03
Kunduz|Kunduz|AF|36.73|68.86
Fengcheng|Jiangsu|CN|34.7|116.59
Trang Bang|Tay Ninh|VN|11.03|106.36
Unnao|Uttar Pradesh|IN|26.55|80.49
Hortaleza|Madrid|ES|40.47|-3.64
N'dalatando|Cuanza Norte|AO|-9.3|14.91
Budaun|Uttar Pradesh|IN|28.04|79.13
Ogaki|Gifu|JP|35.35|136.62
Newport|Wales|GB|51.59|-3
Coquimbo|Coquimbo Region|CL|-29.95|-71.34
Baubau|Southeast Sulawesi|ID|-5.46|122.6
GJuc Trong|Lam Dong|VN|11.74|108.37
Blitar|East Java|ID|-8.1|112.17
Alagoinhas|Bahia|BR|-12.14|-38.42
KwaDukuza|KwaZulu-Natal|ZA|-29.33|31.29
Miyakonojo|Miyazaki|JP|31.73|131.07
Madhyamgram|West Bengal|IN|22.69|88.45
Lancaster|CA|US|34.7|-118.14
Rubtsovsk|Altai Krai|RU|51.51|81.21
Tacheng|Xinjiang|CN|46.75|82.96
Kindia|Kindia|GN|10.06|-12.87
Tauranga|Bay of Plenty|NZ|-37.69|176.17
Kalemie|Tanganyika|CD|-5.95|29.19
Chatuchak|Bangkok|TH|13.83|100.56
San Juan de los Morros|Guarico|VE|9.91|-67.35
Sayama|Saitama|JP|35.85|139.41
Sullana|Piura|PE|-4.9|-80.69
's-Hertogenbosch|North Brabant|NL|51.7|5.3
Szeged|Csongrad|HU|46.25|20.15
Malakal|Upper Nile|SS|9.53|31.66
Chittoor|Andhra Pradesh|IN|13.21|79.1
Toledo|Parana|BR|-24.71|-53.74
Salamanca|Guanajuato|MX|20.57|-101.2
Ban Khlong Prawet|Bangkok|TH|13.72|100.68
La Gi|Lam Dong|VN|10.66|107.77
Anderlecht|Brussels Capital|BE|50.84|4.31
Mytishchi|Moscow Oblast|RU|55.91|37.73
Delegacion Cuajimalpa de Morelos|Mexico City|MX|19.37|-99.29
Hebron|West Bank|PS|31.53|35.09
Camaragibe|Pernambuco|BR|-8.02|-34.98
Mogi Guacu|Sao Paulo|BR|-22.37|-46.95
Mejicanos|San Salvador Department|SV|13.72|-89.19
Tra Vinh|Vinh Long|VN|9.95|106.34
Parepare|South Sulawesi|ID|-4.01|119.63
Jamuria|West Bengal|IN|23.7|87.08
Koudougou|Centre-Ouest|BF|12.25|-2.37
Nyzhnodniprovsk|Dnipropetrovsk|UA|48.48|35.12
Taunggyi|Shan State|MM|20.79|97.04
Dhamar|Dhamar|YE|14.54|44.41
Dubai Investments Park|Dubai|AE|25.01|55.16
Ash Sharqat|Salah ad Din|IQ|35.52|43.23
Dijon|Bourgogne-Franche-Comte|FR|47.31|5.01
Salavat|Bashkortostan Republic|RU|53.38|55.91
Ede|Osun State|NG|7.74|4.44
Sukrah|Ariana Governorate|TN|36.88|10.25
Manzanillo|Colima|MX|19.12|-104.34
Jalapa|Jalapa|GT|14.64|-89.99
Paech'on-up|South Hwanghae|KP|37.99|126.3
Cary|NC|US|35.79|-78.78
Skudai|Johor|MY|1.54|103.66
Tahoua|Tahoua Region|NE|14.89|5.27
Alexandria|VA|US|38.8|-77.05
Tuxtepec|Oaxaca|MX|18.09|-96.13
Puthia|Rajshahi Division|BD|24.37|88.83
Newton|British Columbia|CA|49.13|-122.85
Paris 16 Passy|Ile-de-France|FR|48.86|2.28
Zhicheng|Hubei|CN|30.3|111.5
Ang Mo Kio New Town||SG|1.38|103.84
Limuru|Kiambu County|KE|-1.11|36.64
San Miguel del Padron|Havana|CU|23.1|-82.33
Tarija|Tarija Department|BO|-21.54|-64.73
Patos de Minas|Minas Gerais|BR|-18.58|-46.52
Oldenburg|Lower Saxony|DE|53.14|8.21
Paris 17 Batignolles-Monceau|Ile-de-France|FR|48.88|2.32
Matsusaka|Mie|JP|34.58|136.54
Catamarca|Catamarca|AR|-28.47|-65.79
Tochigi|Tochigi|JP|36.38|139.73
Khoroshevo-Mnevniki|Moscow|RU|55.78|37.47
Bibirevo|Moscow|RU|55.88|37.6
Bordj Bou Arreridj|Bordj Bou Arreridj|DZ|36.07|4.76
Dila|South Ethiopia Regional State|ET|6.42|38.32
Jaigaon|West Bengal|IN|26.85|89.38
Atibaia|Sao Paulo|BR|-23.12|-46.55
Batala|Punjab|IN|31.81|75.2
Grenoble|Auvergne-Rhone-Alpes|FR|45.18|5.71
Samarra'|Salah ad Din|IQ|34.2|43.89
Tempe Junction|AZ|US|33.41|-111.94
Palmdale|CA|US|34.58|-118.12
George Town|Penang|MY|5.41|100.34
El Achir|Bordj Bou Arreridj|DZ|36.06|4.63
Hayward|CA|US|37.67|-122.08
Orai|Uttar Pradesh|IN|25.99|79.45
Thot Not|Can Tho City|VN|10.27|105.53
Gweru|Midlands Province|ZW|-19.45|29.82
Abaetetuba|Para|BR|-1.72|-48.88
Centro Habana|Havana|CU|23.13|-82.37
Panguila|Bengo|AO|-8.69|13.45
Bukit Batok New Town||SG|1.36|103.76
Chom Thong|Bangkok|TH|13.68|100.48
Gol'yanovo|Moscow|RU|55.82|37.81
Sunggal|North Sumatra|ID|3.58|98.62
Industrialnyi|Kharkiv|UA|49.95|36.37
Admiralteisky|St.-Petersburg|RU|59.92|30.3
Diourbel|Diourbel Region|SN|14.65|-16.24
Ueda|Nagano|JP|36.4|138.28
Aberdeen|Southern District|HK|22.25|114.15
Avtozavodskyi|Poltava|UA|49.1|33.43
Salinas|CA|US|36.68|-121.66
San Blas-Canillejas|Madrid|ES|40.44|-3.62
Cuautla|Morelos|MX|18.81|-98.96
Salzburg|Salzburg|AT|47.8|13.04
Perbaungan|North Sumatra|ID|3.57|98.96
Nong Chok|Bangkok|TH|13.86|100.86
Ussuriysk|Primorye|RU|43.8|131.96
Arif Wala|Balochistan|PK|26.32|66.3
Nanpiao|Liaoning|CN|41.1|120.75
Livorno|Tuscany|IT|43.54|10.33
Rio Cuarto|Cordoba|AR|-33.13|-64.35
Harar|Harari|ET|9.31|42.12
Tiraspol|Transnistria|MD|46.84|29.63
Enfield Town|England|GB|51.65|-0.08
Westonaria|Gauteng|ZA|-26.32|27.65
Lizhi|Chongqing|CN|29.7|107.4
Hitachi-Naka|Ibaraki|JP|36.4|140.53
Saharsa|Bihar|IN|25.87|86.6
Qalyub|Qalyubia|EG|30.18|31.21
Escuintla|Escuintla|GT|14.3|-90.79
Marbella|Andalusia|ES|36.52|-4.89
Eregli|Konya|TR|37.51|34.05
Batu Pahat|Johor|MY|1.85|102.93
Sitiawan|Perak|MY|4.22|100.7
Mariveles|Central Luzon|PH|14.43|120.49
San Pablo de las Salinas|Mexico|MX|19.67|-99.09
Lampang|Lampang|TH|18.29|99.49
York|England|GB|53.96|-1.08
Bac Lieu|Ca Mau|VN|9.29|105.73
Juja|Kiambu County|KE|-1.1|37.01
Nek'emte|Oromiya|ET|9.08|36.55
Fes al Bali|Fes-Meknes|MA|34.07|-4.95
OErebro|OErebro|SE|59.27|15.21
Al Miqdadiyah|Diyala|IQ|33.98|44.94
Katsuta|Ibaraki|JP|36.38|140.53
Malabo|Bioko Norte|GQ|3.76|8.78
Vidisha|Madhya Pradesh|IN|23.53|77.81
Tuy Hoa|Dak Lak|VN|13.1|109.32
Yizhou|Guangxi|CN|24.5|108.67
Xinqiao|Shanghai|CN|31.07|121.31
Sunnyvale|CA|US|37.37|-122.04
Tema|Greater Accra|GH|5.67|-0.02
Yichun|Heilongjiang|CN|47.72|128.88
GJuc Pho|Quang Ngai|VN|14.81|108.96
San Martin Texmelucan de Labastida|Puebla|MX|19.28|-98.44
Ar Ramtha|Irbid|JO|32.56|36.01
Hanumangarh|Rajasthan|IN|29.58|74.33
Sao Mateus|Sao Paulo|BR|-23.61|-46.48
Zemun|Central Serbia|RS|44.85|20.4
Telford|England|GB|52.68|-2.45
Kisi|Oyo State|NG|9.08|3.85
Nilopolis|Rio de Janeiro|BR|-22.81|-43.41
Villa Canales|Guatemala|GT|14.48|-90.53
Guyong|Central Luzon|PH|14.84|120.98
Settat|Casablanca-Settat|MA|33|-7.62
Brusque|Santa Catarina|BR|-27.1|-48.91
Paco do Lumiar|Maranhao|BR|-2.53|-44.11
Jampur|Punjab|PK|29.64|70.6
Port Louis|Port Louis|MU|-20.16|57.5
Kawanishi|Hyogo|JP|34.82|135.42
Thanesar|Haryana|IN|29.97|76.83
Al Hawamidiyah|Giza|EG|29.9|31.25
Hassan|Karnataka|IN|13.01|76.1
Lianghu|Zhejiang|CN|29.99|120.9
Tetuan de las Victorias|Madrid|ES|40.46|-3.7
Kishangarh|Rajasthan|IN|26.59|74.85
Birendranagar|Karnali Pradesh|NP|28.6|81.62
Dalupura|Delhi|IN|28.61|77.32
Guangshui|Hubei|CN|31.62|114
Saint-Denis|Reunion|RE|-20.88|55.45
Braila|Braila County|RO|45.27|27.97
Lyubertsy|Moscow Oblast|RU|55.68|37.89
Bumba|Mongala|CD|2.19|22.47
Rudrapur|Uttarakhand|IN|28.98|79.4
La Serena|Coquimbo Region|CL|-29.91|-71.25
Miskolc|Borsod-Abauj-Zemplen|HU|48.1|20.78
Abu Kabir|Sharqia|EG|30.73|31.67
Fu'an|Fujian|CN|27.09|119.64
Kitengela|Kajiado County|KE|-1.48|36.96
Frisco|TX|US|33.15|-96.82
Zhaodong|Heilongjiang|CN|46.05|125.96
Wujiaqu|Xinjiang|CN|44.16|87.52
Shomolu|Lagos|NG|6.54|3.37
Janzur|Al Jafarah|LY|32.82|13.02
Xai-Xai|Gaza Province|MZ|-25.05|33.64
Springfield|MA|US|42.1|-72.59
Nalgonda|Telangana|IN|17.05|79.27
Katabi|Central Region|UG|0.08|32.47
Gwangyang|Jeollanam-do|KR|34.94|127.7
Kovrov|Vladimir Oblast|RU|56.36|41.32
Viransehir|Sanliurfa|TR|37.22|39.76
Noda|Chiba|JP|35.95|139.87
San Cristobal|San Cristobal|DO|18.42|-70.11
East Chattanooga|TN|US|35.07|-85.25
Limassol|Limassol|CY|34.68|33.04
Kariya|Aichi|JP|34.98|136.98
Pasadena|TX|US|29.69|-95.21
Mit Ghamr|Dakahlia|EG|30.72|31.26
Sanshui|Guangdong|CN|23.15|112.89
Jackson|MS|US|32.3|-90.18
Parelheiros|Sao Paulo|BR|-23.83|-46.73
Enschede|Overijssel|NL|52.22|6.9
Boshan|Shandong|CN|36.48|117.83
Hazaribagh|Jharkhand|IN|23.99|85.36
Yangchun|Guangdong|CN|22.17|111.78
Souk Ahras|Souk Ahras|DZ|36.29|7.95
Musanze|Northern Province|RW|-1.5|29.63
Medinipur|West Bengal|IN|22.42|87.32
Andong|Gyeongsangbuk-do|KR|36.57|128.72
Balurghat|West Bengal|IN|25.22|88.78
Pomona|CA|US|34.06|-117.75
Valle de La Pascua|Guarico|VE|9.22|-66.01
Kreuzberg|State of Berlin|DE|52.5|13.4
Chincha Alta|Ica|PE|-13.41|-76.13
Cairns|Queensland|AU|-16.92|145.77
Fyzabad|Uttar Pradesh|IN|26.78|82.15
Thi Tran Thuan Chau|Son La Province|VN|21.44|103.69
Dinapore|Bihar|IN|25.64|85.05
Dingzhou|Hebei|CN|38.51|114.99
Kansas City|KS|US|39.11|-94.63
As Samawah|Muthanna|IQ|31.33|45.29
Porbandar|Gujarat|IN|21.64|69.61
Sinp'o|South Hamgyong|KP|40.04|128.19
Pengpu|Shanghai|CN|31.29|121.44
Wazirabad|Punjab|PK|32.44|74.12
Washington Heights|NY|US|40.85|-73.94
Lakewood|CO|US|39.7|-105.08
Baqubah|Diyala|IQ|33.75|44.61
Sumayl|Duhok|IQ|36.86|42.85
Simele|Duhok|IQ|36.86|42.85
Neuss|North Rhine-Westphalia|DE|51.2|6.69
Chenghua|Guangdong|CN|23.46|116.77
Songnim-ni|North Hwanghae|KP|38.76|125.64
Banda|Uttar Pradesh|IN|25.48|80.33
Can Giuoc|Tay Ninh|VN|10.61|106.67
Balvanera|Buenos Aires F.D.|AR|-34.61|-58.4
Longfeng|Heilongjiang|CN|46.53|125.1
Beining|Liaoning|CN|41.6|121.79
Strogino|Moscow|RU|55.82|37.41
Gonbad-e Kavus|Golestan|IR|37.25|55.17
Etwatwa|Gauteng|ZA|-26.13|28.45
Higashimurayama|Tokyo|JP|35.75|139.47
Garanhuns|Pernambuco|BR|-8.88|-36.5
Hindupur|Andhra Pradesh|IN|13.83|77.49
Amsterdam Nieuw-West|North Holland|NL|52.36|4.81
Stavanger|Rogaland|NO|58.97|5.73
Bintulu|Sarawak|MY|3.17|113.03
Poole|England|GB|50.71|-1.98
Akhmim|Sohag|EG|26.56|31.75
Kohat|Khyber Pakhtunkhwa|PK|33.58|71.45
Regensburg|Bavaria|DE|49.02|12.1
Layyah|Punjab|PK|30.96|70.94
Girga|Sohag|EG|26.34|31.89
Koforidua|Eastern|GH|6.09|-0.26
Bukit Merah Estate||SG|1.28|103.82
Logrono|La Rioja|ES|42.47|-2.45
Beawar|Rajasthan|IN|26.1|74.32
Sykhiv|Lviv|UA|49.79|24.06
Shujaabad|Punjab|PK|29.88|71.29
Escondido|CA|US|33.12|-117.09
Suwaylih|Balqa|JO|32.02|35.84
Erzincan|Erzincan|TR|39.74|39.49
Kirsehir|Kirsehir|TR|39.15|34.16
Zarichnyi|Sumy|UA|50.9|34.81
La Laguna|Canary Islands|ES|28.49|-16.32
Kokshetau|Aqmola|KZ|53.28|69.39
Eminabad|Punjab|PK|32.04|74.26
Anantnag|Jammu and Kashmir|IN|33.73|75.15
Kukichuo|Saitama|JP|36.07|139.67
Badajoz|Extremadura|ES|38.88|-6.97
Serilingampalle|Telangana|IN|17.49|78.3
Malatia-Sebastia|Yerevan|AM|40.17|44.45
Talcahuano|Biobio|CL|-36.72|-73.12
Chillan|Nuble|CL|-36.61|-72.1
Jaranwala|Punjab|PK|31.33|73.42
Ky Anh|Ha Tinh Province|VN|18.06|106.3
Nong Khaem|Bangkok|TH|13.71|100.35
Piedras Negras|Coahuila|MX|28.7|-100.52
Kiziltepe|Mardin|TR|37.19|40.58
Astoria|NY|US|40.77|-73.93
Musashino|Tokyo|JP|35.71|139.56
Paranagua|Parana|BR|-25.52|-48.53
Balashikha|Moscow Oblast|RU|55.79|37.95
Raigarh|Chhattisgarh|IN|21.9|83.4
Gloucester|Ontario|CA|45.35|-75.63
Vryheid|KwaZulu-Natal|ZA|-27.77|30.79
Malkajgiri|Telangana|IN|17.45|78.53
Gimcheon|Gyeongsangbuk-do|KR|36.12|128.12
Bercham|Perak|MY|4.64|101.14
Setia Alam|Selangor|MY|3.1|101.46
Bandar Tasik Puteri|Selangor|MY|3.29|101.47
Tordher|Khyber Pakhtunkhwa|PK|33.99|72.29
Zhulebino|Moscow|RU|55.7|37.85
Dili|Dili Municipality|TL|-8.56|125.57
Shantipur|West Bengal|IN|23.25|88.43
Chishtian|Punjab|PK|29.8|72.86
Playa del Carmen|Quintana Roo|MX|20.63|-87.08
Santa Rita|Paraiba|BR|-7.11|-34.98
Split|Split-Dalmatia|HR|43.51|16.44
Ursynow|Mazovia|PL|52.15|21.05
Hollywood|FL|US|26.01|-80.15
Madrid Centro|Madrid|ES|40.42|-3.7
Iguatemi|Sao Paulo|BR|-23.61|-46.43
Harunabad|Punjab|PK|29.61|73.14
Shunan|Yamaguchi|JP|34.08|131.83
Agadez|Agadez|NE|16.97|7.99
Burnley|England|GB|53.8|-2.23
Rehovot|Central District|IL|31.89|34.81
Watampone|South Sulawesi|ID|-4.54|120.33
Sabha|Sabha District|LY|27.04|14.43
Disuq|Kafr el-Sheikh|EG|31.13|30.65
Cagliari|Sardinia|IT|39.23|9.12
Borough Park|NY|US|40.63|-74
Harrow|England|GB|51.58|-0.33
Berrechid|Casablanca-Settat|MA|33.27|-7.59
Queimados|Rio de Janeiro|BR|-22.72|-43.56
Tambacounda|Tambacounda|SN|13.77|-13.67
Huddersfield|England|GB|53.65|-1.78
Arabi|Somali|ET|9.96|42.49
Kerch|Crimea|UA|45.36|36.48
Saguenay|Quebec|CA|48.42|-71.07
Prenzlauer Berg Bezirk|State of Berlin|DE|52.54|13.42
Fazenda Rio Grande|Parana|BR|-25.66|-49.31
Komaki|Aichi|JP|35.28|136.92
Marvdasht|Fars|IR|29.87|52.8
Melitopol|Zaporizhzhia|UA|46.85|35.38
Dunhua|Jilin|CN|43.37|128.23
Bhuj|Gujarat|IN|23.25|69.67
Arganzuela|Madrid|ES|40.4|-3.7
Jyvaeskylae|Central Finland|FI|62.24|25.72
Yonago|Tottori|JP|35.43|133.33
Ruqi|Awdal|SO|9.97|43.43
Rimini|Emilia-Romagna|IT|44.06|12.57
Coquitlam|British Columbia|CA|49.28|-122.78
Ad-Dawahy|Port Said|EG|31.24|32.28
Arar|Northern Borders Region|SA|30.98|41.04
Valencia|CA|US|34.44|-118.61
Moreno|Buenos Aires|AR|-34.63|-58.79
Tama|Tokyo|JP|35.64|139.47
Rockford|IL|US|42.27|-89.09
Kalaban Koro|Koulikoro|ML|12.57|-8.03
El Limon|Aragua|VE|10.31|-67.63
Nimes|Occitanie|FR|43.84|4.36
Dundee|Scotland|GB|56.47|-2.97
Barakpur|West Bengal|IN|22.77|88.36
Sao Rafael|Sao Paulo|BR|-23.63|-46.45
Sujiatun|Liaoning|CN|41.66|123.34
Astanajapura|West Java|ID|-6.8|108.63
Xebat|Erbil|IQ|36.28|43.67
Ciudad Delicias|Chihuahua|MX|28.19|-105.47
Siguiri|Kankan Region|GN|11.42|-9.17
Mbanza Kongo|Zaire|AO|-6.27|14.24
Kamsar|Boke Region|GN|10.65|-14.62
East Hampton|VA|US|37.04|-76.33
Honggang|Heilongjiang|CN|46.4|124.88
Sarria-Sant Gervasi|Catalonia|ES|41.4|2.14
Kiambu|Kiambu County|KE|-1.17|36.84
Clermont-Ferrand|Auvergne-Rhone-Alpes|FR|45.78|3.09
Joliet|IL|US|41.53|-88.08
Barrie|Ontario|CA|44.4|-79.67
Yima|Henan|CN|34.74|111.88
Bang Kapi|Bangkok|TH|13.77|100.65
Savannah|GA|US|32.08|-81.1
Paterson|NJ|US|40.92|-74.17
Salamanca|Madrid|ES|40.43|-3.68
Kolomna|Moscow Oblast|RU|55.07|38.78
Hajipur|Bihar|IN|25.69|85.21
Rafsanjan|Kerman|IR|30.41|55.99
Hoa Thanh|Tay Ninh|VN|11.29|106.13
Mestre|Veneto|IT|45.49|12.25
As Salimiyah|Hawalli|KW|29.33|48.08
Bridgeport|CT|US|41.18|-73.19
Shevchenko|Poltava|UA|49.56|34.54
Kuntsevo|Moscow|RU|55.74|37.4
Kragujevac|Central Serbia|RS|44.02|20.92
Aktau|Mangystau|KZ|43.66|51.17
Nusantara|East Kalimantan|ID|-0.97|116.71
Balcon de la Lisa|Havana|CU|23.05|-82.45
Sasaram|Bihar|IN|24.95|84.02
Bohuniya|Zhytomyr Oblast|UA|50.28|28.61
Iruma|Saitama|JP|35.82|139.37
Renca|Santiago Metropolitan|CL|-33.4|-70.71
Kramatorsk|Donetsk|UA|48.73|37.57
Naperville|IL|US|41.79|-88.15
Manama|Manama|BH|26.23|50.59
Colima|Colima|MX|19.24|-103.71
Bhimavaram|Andhra Pradesh|IN|16.54|81.52
Larisa|Thessaly|GR|39.63|22.42
Nakhodka|Primorye|RU|42.84|132.92
Debre Birhan|Amhara|ET|9.68|39.53
Cacuaco|Luanda|AO|-8.78|13.37
Slobidskyi|Kharkiv|UA|49.94|36.28
Aix-en-Provence|Provence-Alpes-Cote d'Azur|FR|43.53|5.45
Cam Ranh|Khanh Hoa|VN|11.92|109.16
Jalalpur Jattan|Punjab|PK|32.64|74.21
Matanzas|Matanzas Province|CU|23.04|-81.58
Beed|Maharashtra|IN|18.99|75.76
Khasnahzan|Erbil|IQ|36.2|44.14
Taozhou|Anhui|CN|30.91|119.41
Saint-Quentin-en-Yvelines|Ile-de-France|FR|48.77|2.02
Bandar Bukit Raja|Selangor|MY|3.09|101.43
Blackburn|England|GB|53.75|-2.48
Rosemont-La Petite-Patrie|Quebec|CA|45.54|-73.61
Colina|Santiago Metropolitan|CL|-33.2|-70.67
Burari|Delhi|IN|28.76|77.2
Ruda Slaska|Silesia|PL|50.26|18.86
Nouadhibou|Dakhlet Nouadhibou|MR|20.94|-17.04
Puerto Plata|Puerto Plata|DO|19.79|-70.69
Urdaneta|Ilocos|PH|15.98|120.57
Chamberi|Madrid|ES|40.43|-3.7
Krishnanagar|West Bengal|IN|23.41|88.49
Xinji|Hebei|CN|37.93|115.22
Jutiapa|Jutiapa|GT|14.28|-89.89
Chitradurga|Karnataka|IN|14.22|76.4
Bueng Kum|Bangkok|TH|13.79|100.67
Cambridge|England|GB|52.2|0.12
Kampung Pasir Gudang Baru|Johor|MY|1.47|103.88
Kampung Sungai Glugur|Penang|MY|5.37|100.31
Dibrugarh|Assam|IN|27.48|94.91
Medea|Medea|DZ|36.26|2.75
Taishan|Guangdong|CN|22.25|112.78
El Eulma|Setif|DZ|36.15|5.69
Pecs|Baranya|HU|46.08|18.23
Gia Rai|Ca Mau|VN|9.23|105.46
Abohar|Punjab|IN|30.14|74.2
Tiruvannamalai|Tamil Nadu|IN|12.23|79.07
Teixeira de Freitas|Bahia|BR|-17.54|-39.74
Gainesville|FL|US|29.65|-82.32
Concordia|Entre Rios|AR|-31.39|-58.02
Botucatu|Sao Paulo|BR|-22.89|-48.45
Fujieda|Shizuoka|JP|34.87|138.27
Spanish Town|Saint Catherine Parish|JM|17.99|-76.96
Blackpool|England|GB|53.82|-3.05
Urganch|Xorazm Region|UZ|41.55|60.63
Bukoba|Kagera|TZ|-1.33|31.81
Kaithal|Haryana|IN|29.8|76.4
Ingombota|Luanda|AO|-8.82|13.23
Brest|Brittany|FR|48.39|-4.49
Basildon|England|GB|51.57|0.46
Franco da Rocha|Sao Paulo|BR|-23.32|-46.73
Salamanca|Castille and Leon|ES|40.97|-5.66
Villeray-Saint-Michel-Parc-Extension|Quebec|CA|45.56|-73.61
Mesquite|TX|US|32.77|-96.6
Ashikaga|Tochigi|JP|36.33|139.45
Huyen Lam Ha|Lam Dong|VN|11.82|108.21
Acheng|Heilongjiang|CN|45.55|126.95
Kelowna|British Columbia|CA|49.88|-119.49
Umarkot|Sindh|PK|25.36|69.74
Leon|Leon Department|NI|12.44|-86.88
Kakamigahara|Gifu|JP|35.42|136.87
Le Mans|Pays de la Loire|FR|48|0.2
Lodhran|Punjab|PK|29.53|71.63
Campo Largo|Parana|BR|-25.46|-49.53
Trois-Rivieres|Quebec|CA|46.35|-72.55
Hailin|Heilongjiang|CN|44.57|129.39
Amsterdam-Zuid|North Holland|NL|52.35|4.88
Tsuchiura|Ibaraki|JP|36.09|140.21
Elektrostal'|Moscow Oblast|RU|55.79|38.46
Balasore|Odisha|IN|21.49|86.93
Yong'an|Chongqing|CN|31.02|109.46
Paris 11e Arrondissement|Ile-de-France|FR|48.86|2.38
Kampong Pasir Ris||SG|1.38|103.93
Huelva|Andalusia|ES|37.27|-6.94
Nemyshlyanskyi|Kharkiv|UA|49.96|36.33
Navoiy|Navoiy Region|UZ|40.08|65.38
Syracuse|NY|US|43.05|-76.15
Ashkelon|Southern District|IL|31.67|34.57
Pinetown|KwaZulu-Natal|ZA|-29.82|30.89
Teshi Old Town|Greater Accra|GH|5.58|-0.11
Biryulevo|Moscow|RU|55.59|37.68
Orekhovo-Borisovo|Moscow|RU|55.61|37.73
Kusatsu|Shiga|JP|35.02|135.97
Amsterdam-West|North Holland|NL|52.38|4.87
Nanjin|Chongqing|CN|29.98|106.27
Guelph|Ontario|CA|43.55|-80.26
Qianjiang|Chongqing|CN|29.53|108.77
Ramna Maidan|Dhaka Division|BD|23.73|90.4
Godhra|Gujarat|IN|22.78|73.61
Khemisset|Rabat-Sale-Kenitra|MA|33.82|-6.07
Canakkale|Canakkale|TR|40.16|26.41
Torrance|CA|US|33.84|-118.34
Tres Lagoas|Mato Grosso do Sul|BR|-20.79|-51.7
San Jose|Mimaropa|PH|12.35|121.07
Ladysmith|KwaZulu-Natal|ZA|-28.56|29.78
Levis|Quebec|CA|46.8|-71.18
Cachoeirinha|Sao Paulo|BR|-23.45|-46.66
Heidelberg|Baden-Wurttemberg|DE|49.41|8.69
Fresnillo|Zacatecas|MX|23.17|-102.87
Touggourt|Touggourt|DZ|33.11|6.07
Shillong|Meghalaya|IN|25.57|91.88
Surprise|AZ|US|33.63|-112.33
Norwich|England|GB|52.63|1.3
Tinh Bien|An Giang|VN|10.6|104.94
Moriguchi|Osaka|JP|34.73|135.57
Amiens|Hauts-de-France|FR|49.9|2.3
Cai Lay|Dong Thap|VN|10.4|106.12
Rewari|Haryana|IN|28.2|76.62
Basirhat City|West Bengal|IN|22.66|88.85
Novyye Kuz'minki|Moscow|RU|55.7|37.75
Kuz'minki|Moscow|RU|55.7|37.8
Aalborg|North Denmark|DK|57.05|9.92
La Trinidad|Cordillera|PH|16.45|120.59
Ghardaia|Ghardaia|DZ|32.49|3.67
Timika|Central Papua|ID|-4.61|136.68
Pyatigorsk|Stavropol Kray|RU|44.05|43.05
Teofilo Otoni|Minas Gerais|BR|-17.86|-41.51
Mbanza-Ngungu|Bas-Congo|CD|-5.26|14.86
Mercier-Hochelaga-Maisonneuve|Quebec|CA|45.57|-73.55
Okinawa|Okinawa|JP|26.34|127.8
Middlesbrough|England|GB|54.58|-1.23
Shahrisabz|Qashqadaryo|UZ|39.06|66.83
Moro|Sindh|PK|26.66|68
Ch'ongdan-up|South Hwanghae|KP|37.97|125.94
Sant Andreu|Catalonia|ES|41.44|2.19
Rybnik|Silesia|PL|50.1|18.54
Saida|Saida|DZ|34.83|0.15
Metairie Terrace|LA|US|29.98|-90.16
Tuzla|Federation of B&H|BA|44.54|18.67
Kovpakivskyi|Sumy|UA|50.93|34.79
eMbalenhle|Mpumalanga|ZA|-26.53|29.07
Trindade|Goias|BR|-16.65|-49.49
Khanpur|Punjab|PK|28.65|70.66
Columbia|SC|US|34|-81.03
Nawabganj|Rajshahi Division|BD|24.59|88.27
Inezgane|Souss-Massa|MA|30.36|-9.54
Puerto Cortez|Cortes Department|HN|15.83|-87.93
Pasadena|CA|US|34.15|-118.14
Toowoomba|Queensland|AU|-27.56|151.95
Paderborn|North Rhine-Westphalia|DE|51.72|8.75
Misato, Saitama|Saitama|JP|35.84|139.88
Chhatarpur|Madhya Pradesh|IN|24.92|79.59
Kimberley|Northern Cape|ZA|-28.73|24.76
Alto Hospicio|Tarapaca|CL|-20.27|-70.1
Ciego de Avila|Ciego de Avila Province|CU|21.84|-78.76
Samalut|Minya|EG|28.31|30.71
Chertanovo Yuzhnoye|Moscow|RU|55.59|37.6
Jieshou|Anhui|CN|33.26|115.36
Maykop|Adygeya Republic|RU|44.61|40.1
Attock City|Punjab|PK|33.77|72.36
Kisaran|North Sumatra|ID|2.98|99.62
Mojokerto|East Java|ID|-7.47|112.43
Facatativa|Cundinamarca|CO|4.81|-74.35
Masai|Johor|MY|1.49|103.88
Punto Fijo|Falcon|VE|11.69|-70.2
Myingyan|Mandalay Region|MM|21.46|95.39
Kamalshahr|Alborz Province|IR|35.86|50.87
Mandsaur|Madhya Pradesh|IN|24.07|75.07
Zheleznodorozhnyy|Moscow Oblast|RU|55.74|38.02
Chas|Jharkhand|IN|23.64|86.17
Jahrom|Fars|IR|28.5|53.56
Tours|Centre-Val de Loire|FR|47.39|0.7
Palanpur|Gujarat|IN|24.17|72.44
Bondoukou|Zanzan District|CI|8.04|-2.8
Chichicastenango|Quiche|GT|14.94|-91.11
Tarragona|Catalonia|ES|41.12|1.25
Cachoeirinha|Rio Grande do Sul|BR|-29.95|-51.09
Tobruk|Al Butnan|LY|32.09|23.95
Sinch'on-up|South Hwanghae|KP|38.35|125.48
Abbotsford|British Columbia|CA|49.06|-122.25
Circoiscrizione II|Piedmont|IT|45.05|7.64
Bolton|England|GB|53.58|-2.43
Yushu|Qinghai|CN|33|97.01
Pitesti|Arges|RO|44.85|24.87
Fukayacho|Saitama|JP|36.2|139.28
Potosi|Potosi Department|BO|-19.58|-65.75
Usera|Madrid|ES|40.39|-3.7
Limoges|New Aquitaine|FR|45.83|1.25
Cangaiba|Sao Paulo|BR|-23.5|-46.52
Salto|Sao Paulo|BR|-23.2|-47.29
Asaka|Saitama|JP|35.8|139.6
Ghazni|Ghazni|AF|33.55|68.42
Orange|CA|US|33.79|-117.85
Wola|Mazovia|PL|52.23|20.96
Sanhe|Chongqing|CN|29.87|107.73
Ilam|Ilam Province|IR|33.64|46.42
Shimotoda|Saitama|JP|35.81|139.69
Comodoro Rivadavia|Chubut|AR|-45.86|-67.49
Kampung Sungai Ara|Penang|MY|5.33|100.27
Fullerton|CA|US|33.87|-117.93
Killeen|TX|US|31.12|-97.73
Norilsk|Krasnoyarsk Krai|RU|69.35|88.2
Lleida|Catalonia|ES|41.62|0.62
Coimbra|Coimbra|PT|40.21|-8.42
Mtwara|Mtwara|TZ|-10.27|40.18
Manjhand|Sindh|PK|25.91|68.24
Beni|North Kivu|CD|0.49|29.47
Debre Mark'os|Amhara|ET|10.35|37.73
Norzagaray|Central Luzon|PH|14.91|121.05
Qeladize|Sulaymaniyah|IQ|36.18|45.13
Vila Curuca|Sao Paulo|BR|-23.51|-46.42
Nigel|Gauteng|ZA|-26.43|28.48
Shengavit|Yerevan|AM|40.16|44.48
Catacamas|Olancho Department|HN|14.85|-85.89
Buea|South-West|CM|4.15|9.24
Shuizhai|Guangdong|CN|23.93|115.76
Al'met'yevsk|Tatarstan Republic|RU|54.9|52.32
Motherwell|Eastern Cape|ZA|-33.79|25.59
Paris 12e Arrondissement|Ile-de-France|FR|48.84|2.44
McAllen|TX|US|26.2|-98.23
Lakhimpur|Uttar Pradesh|IN|27.95|80.78
Ishinomaki|Miyagi|JP|38.42|141.3
Mpumalanga|KwaZulu-Natal|ZA|-29.81|30.64
Mian Channun|Punjab|PK|30.44|72.36
Ji Parana|Rondonia|BR|-10.89|-61.95
Zaanstad|North Holland|NL|52.45|4.81
Kabin Buri|Prachin Buri|TH|13.95|101.72
Kuwana|Mie|JP|35.05|136.67
Ayacucho|Ayacucho|PE|-13.16|-74.22
Torbat-e Heydariyeh|Razavi Khorasan|IR|35.27|59.22
Shanhaiguan|Hebei|CN|40|119.75
Chamartin|Madrid|ES|40.46|-3.68
Saham|Al Batinah North|OM|24.17|56.89
Abeche|Ouadai|TD|13.83|20.83
Peristeri|Attica|GR|38.02|23.69
Amersfoort|Utrecht|NL|52.16|5.39
Darwin|Northern Territory|AU|-12.46|130.84
Jeongeup|Jeollabuk-do|KR|35.6|126.92
Bellevue|WA|US|47.61|-122.2
Korolev|Moscow Oblast|RU|55.91|37.83
Valsad|Gujarat|IN|20.61|72.93
Shinyanga|Shinyanga|TZ|-3.66|33.42
Sollentuna|Stockholm|SE|59.43|17.95
Al Hindiyah|Karbala|IQ|32.54|44.22
Yaizu|Shizuoka|JP|34.87|138.32
Payakumbuh|West Sumatra|ID|-0.22|100.63
Damoh|Madhya Pradesh|IN|23.83|79.44
Asela|Oromiya|ET|7.95|39.13
Haldwani|Uttarakhand|IN|29.22|79.53
Irewe|Lagos|NG|6.42|3.14
Batang|Central Java|ID|-6.48|110.71
Gbongan|Osun State|NG|7.48|4.35
Gama|Federal District|BR|-16.03|-48.07
Siem Reap|Siem Reap|KH|13.36|103.86
Anaco|Anzoategui|VE|9.43|-64.46
Purwodadi|Central Java|ID|-7.09|110.92
Koga|Ibaraki|JP|36.18|139.72
Yuepu|Shanghai|CN|31.43|121.42
Habra|West Bengal|IN|22.84|88.66
Sidoarjo|East Java|ID|-7.45|112.72
Kyivskyi|Donetsk|UA|48.05|37.78
Sabah as Salim|Mubarak al Kabir|KW|29.26|48.06
Balneario Camboriu|Santa Catarina|BR|-26.99|-48.63
Plaza de la Revolucion|Havana|CU|23.12|-82.39
Lausanne|Vaud|CH|46.52|6.63
Choloma|Cortes Department|HN|15.61|-87.95
Barcarena|Para|BR|-1.51|-48.63
Kairouan|Kairouan|TN|35.68|10.1
Stockport|England|GB|53.41|-2.16
Budapest XI. keruelet|Budapest|HU|47.48|19.04
Huadian|Jilin|CN|42.97|126.74
Crato|Ceara|BR|-7.23|-39.41
Kousseri|Far North|CM|12.08|15.03
Weru|West Java|ID|-6.71|108.5
Al-'Ubur|Qalyubia|EG|30.23|31.48
Kolpino|St.-Petersburg|RU|59.75|30.59
Itapipoca|Ceara|BR|-3.49|-39.58
Conselheiro Lafaiete|Minas Gerais|BR|-20.66|-43.79
Belgrano|Buenos Aires F.D.|AR|-34.56|-58.46
Sarh|Moyen-Chari|TD|9.15|18.38
Gingoog|Northern Mindanao|PH|8.83|125.1
San Juan del Rio|Queretaro|MX|20.39|-100
Sekondi-Takoradi|Western|GH|4.93|-1.76
Liuzhi|Guizhou|CN|26.23|105.43
Altamira|Para|BR|-3.2|-52.21
Naga|Central Visayas|PH|10.21|123.76
Fuyu|Jilin|CN|45.18|124.82
Wudan|Inner Mongolia|CN|42.93|119.02
Vespasiano|Minas Gerais|BR|-19.69|-43.92
Whitby|Ontario|CA|43.88|-78.93
Metairie|LA|US|29.98|-90.15
Chaohu|Anhui|CN|31.6|117.87
Kolar|Karnataka|IN|13.14|78.13
Bizerte|Bizerte Governorate|TN|37.27|9.87
Tariba|Tachira|VE|7.82|-72.22
Ejigbo|Osun State|NG|7.9|4.31
Santa Cruz do Sul|Rio Grande do Sul|BR|-29.72|-52.43
Ksar El Kebir|Tanger-Tetouan-Al Hoceima|MA|35|-5.9
Paris 11 Popincourt|Ile-de-France|FR|48.86|2.38
Dabou|Lagunes District|CI|5.33|-4.38
Bukit Panjang New Town||SG|1.38|103.76
Sao Lucas|Sao Paulo|BR|-23.59|-46.54
Paris 12 Reuilly|Ile-de-France|FR|48.84|2.39
Bertoua|East|CM|4.58|13.68
Jacmel|Sud-Est|HT|18.24|-72.54
Srikakulam|Andhra Pradesh|IN|18.3|83.9
Candelaria|Calabarzon|PH|13.93|121.42
Araruama|Rio de Janeiro|BR|-22.87|-42.34
Vinh Long|Vinh Long|VN|10.25|105.97
Praia|Praia|CV|14.93|-23.51
Resende|Rio de Janeiro|BR|-22.47|-44.45
Liangping|Chongqing|CN|30.66|107.77
Kirdasah|Giza|EG|30.03|31.11
Ponce|Ponce|PR|18.01|-66.62
Doilungdeqen|Tibet|CN|29.66|90.99
Jieshi|Guangdong|CN|22.81|115.83
Hejiang|Sichuan|CN|28.81|105.83
Pasir Puteh|Kelantan|MY|5.83|102.4
Mandya|Karnataka|IN|12.52|76.9
Xiayang|Shanghai|CN|31.15|121.12
Nor Nork|Yerevan|AM|40.2|44.57
Bhisho|Eastern Cape|ZA|-32.85|27.44
Freguesia do O|Sao Paulo|BR|-23.5|-46.7
Subang|West Java|ID|-6.57|107.76
Madhurampur Dehri|Bihar|IN|24.97|84.2
Negombo|Western Province|LK|7.21|79.84
Irakleion|Crete|GR|35.33|25.14
Hampton|VA|US|37.03|-76.35
Wuyishan|Fujian|CN|27.76|118.03
Miramar|FL|US|25.99|-80.23
Jiashan|Zhejiang|CN|30.85|120.93
Jiagedaqi|Inner Mongolia|CN|50.42|124.12
Bilqas|Dakahlia|EG|31.21|31.36
Rangkasbitung|Banten|ID|-6.36|106.25
Odintsovo|Moscow Oblast|RU|55.67|37.28
Foggia|Apulia|IT|41.46|15.55
Antsiranana|Diana|MG|-12.32|49.29
Kanchrapara|West Bengal|IN|22.96|88.43
San Juan Sacatepequez|Guatemala|GT|14.72|-90.64
Minoh|Osaka|JP|34.83|135.47
Funtua|Katsina State|NG|11.52|7.31
St. Catharines|Ontario|CA|43.17|-79.24
Dawei|Tanintharyi Region|MM|14.08|98.19
Igboho|Oyo State|NG|8.84|3.76
Gunungsitoli|North Sumatra|ID|1.29|97.61
Apeldoorn|Gelderland|NL|52.21|5.97
Cidade Lider|Sao Paulo|BR|-23.56|-46.49
Marivan|Kurdistan Province|IR|35.52|46.18
Phu Ly|Ninh Binh|VN|20.55|105.91
Divo|Goh-Djiboua|CI|5.84|-5.36
Huinong|Ningxia|CN|39.23|106.77
Ebina|Kanagawa|JP|35.38|139.4
Larache|Tanger-Tetouan-Al Hoceima|MA|35.19|-6.16
Varginha|Minas Gerais|BR|-21.55|-45.43
Paris 14 Observatoire|Ile-de-France|FR|48.83|2.33
Van Nuys|CA|US|34.19|-118.45
Bush|Beni Suweif|EG|29.15|31.13
Mlolongo|Machakos County|KE|-1.4|36.94
Guarapari|Espirito Santo|BR|-20.67|-40.5
Tuong Mai|Hanoi|VN|20.99|105.86
San Jose del Cabo|Baja California Sur|MX|23.05|-109.7
West Valley City|UT|US|40.69|-112
Kisarazu|Chiba|JP|35.38|139.93
Gejiu|Yunnan|CN|23.36|103.15
Bacau|Bacau County|RO|46.57|26.91
Saaba|Centre|BF|12.37|-1.41
Mingaladon|Yangon|MM|16.92|96.1
Dimapur|Nagaland|IN|25.91|93.72
Sasolburg|Free State|ZA|-26.81|27.82
Cheras|Selangor|MY|3.11|101.73
Tasek Glugor|Penang|MY|5.48|100.5
Osorno|Los Lagos Region|CL|-40.57|-73.13
Amsterdam-Oost|North Holland|NL|52.35|4.93
Araras|Sao Paulo|BR|-22.36|-47.38
Tumxuk|Xinjiang|CN|39.87|79.06
Kushtia|Khulna Division|BD|23.9|89.12
Pitalito|Huila Department|CO|1.85|-76.05
Baliuag|Central Luzon|PH|14.95|120.9
Hoan Kiem|Hanoi|VN|21.03|105.85
Kajansi|Central Region|UG|0.22|32.53
Isahaya|Nagasaki|JP|32.84|130.04
Dayton|OH|US|39.76|-84.19
Cam Pha Mines|Quang Ninh|VN|21.02|107.3
Petapa|Guatemala|GT|14.5|-90.56
Maler Kotla|Punjab|IN|30.53|75.88
Buguma|Rivers State|NG|4.74|6.86
Itaituba|Para|BR|-4.28|-55.98
Ahuntsic-Cartierville|Quebec|CA|45.57|-73.67
Shiqiao|Guangdong|CN|22.95|113.36
Pyay|Bago Region|MM|18.82|95.22
Rabak|White Nile|SD|13.18|32.74
Tay Ninh|Tay Ninh|VN|11.31|106.1
Le Vieux-Longueuil|Quebec|CA|45.54|-73.51
Tyre|South Governorate|LB|33.27|35.19
Kutaisi|Imereti|GE|42.27|42.69
Andimeshk|Khuzestan|IR|32.46|48.35
Siwan|Bihar|IN|26.22|84.36
Madrid|Cundinamarca|CO|4.73|-74.26
Angono|Calabarzon|PH|14.53|121.15
Cartago|Valle del Cauca Department|CO|4.75|-75.91
Shahreza|Isfahan|IR|32.01|51.86
Hinthada|Ayeyarwady|MM|17.65|95.46
Apucarana|Parana|BR|-23.55|-51.46
Cap-Haitien|Nord|HT|19.76|-72.2
Baturaja|South Sumatra|ID|-4.13|104.17
Inazawa|Aichi|JP|35.25|136.78
Rodriguez|Calabarzon|PH|14.76|121.2
Kalol|Gujarat|IN|23.25|72.5
Miandoab|West Azerbaijan|IR|36.97|46.11
Sao Mateus|Espirito Santo|BR|-18.72|-39.86
Laghouat|Laghouat|DZ|33.8|2.87
Nevinnomyssk|Stavropol Kray|RU|44.63|41.94
San Mateo|Calabarzon|PH|14.7|121.12
Tahta|Sohag|EG|26.77|31.5
San Juan|National Capital Region|PH|14.6|121.03
Sibiu|Sibiu County|RO|45.8|24.15
Olathe|KS|US|38.88|-94.82
El Geneina Fort|Western Darfur|SD|13.47|22.46
Ikirun|Osun State|NG|7.91|4.67
Shenglilu|Chongqing|CN|29.35|105.88
San Nicolas de los Arroyos|Buenos Aires|AR|-33.33|-60.21
Leogane|Ouest|HT|18.51|-72.63
Vila Jacui|Sao Paulo|BR|-23.5|-46.46
Adiwerna|Central Java|ID|-6.94|109.13
Cameta|Para|BR|-2.24|-49.5
Al Qurnah|Basra|IQ|31.02|47.43
Abakaliki|Ebonyi State|NG|6.32|8.11
Vitoria de Santo Antao|Pernambuco|BR|-8.12|-35.29
Marianao|Havana|CU|23.07|-82.43
Warren|MI|US|42.49|-83.01
Cizre|Sirnak|TR|37.33|42.18
Circoiscrizione VIII|Piedmont|IT|45.04|7.67
Bankura|West Bengal|IN|23.23|87.07
Inegol|Bursa Province|TR|40.08|29.51
Ebetsu|Hokkaido|JP|43.11|141.55
Anyama|Abidjan Autonomous District|CI|5.49|-4.05
Jiawang|Jiangsu|CN|34.43|117.44
Singaraja|Bali|ID|-8.11|115.09
Patan|Gujarat|IN|23.85|72.13
Wuerzburg|Bavaria|DE|49.79|9.95
Barysaw|Minsk|BY|54.23|28.5
GJong Hoi|Quang Tri|VN|17.47|106.62
Randfontein|Gauteng|ZA|-26.18|27.7
Pervouralsk|Sverdlovsk Oblast|RU|56.91|59.94
Gonda City|Uttar Pradesh|IN|27.13|81.95
Madinat Hamad|Northern|BH|26.12|50.51
Ome|Tokyo|JP|35.78|139.24
Sinnuris|Faiyum|EG|29.41|30.87
Votorantim|Sao Paulo|BR|-23.55|-47.44
Milagro|Guayas|EC|-2.13|-79.59
Jau|Sao Paulo|BR|-22.3|-48.56
Thandwe|Rakhine|MM|18.47|94.37
Thornton|CO|US|39.87|-104.97
Valdivia|Los Rios Region|CL|-39.81|-73.25
Olmaliq|Tashkent Region|UZ|40.84|69.6
Okrika|Rivers State|NG|4.74|7.08
High Wycombe|England|GB|51.63|-0.75
Carrollton|TX|US|32.95|-96.89
Talisay|Central Visayas|PH|10.24|123.85
Gao|Gao|ML|16.27|-0.04
Dhaulpur|Rajasthan|IN|26.69|77.88
Tarime|Mara|TZ|-1.35|34.37
Kentron|Yerevan|AM|40.18|44.51
Milton|Ontario|CA|43.52|-79.88
M'Sila|M'Sila|DZ|35.71|4.54
Narita|Chiba|JP|35.78|140.32
Franceville|Haut-Ogooue|GA|-1.63|13.58
Puqi|Hubei|CN|29.72|113.88
Tondabayashicho|Osaka|JP|34.5|135.6
Sandacho|Hyogo|JP|34.88|135.23
Gondia|Maharashtra|IN|21.46|80.19
Dunedin|Otago|NZ|-45.87|170.5
Kislovodsk|Stavropol Kray|RU|43.91|42.72
Kyauktan|Yangon|MM|16.64|96.33
Schaerbeek|Brussels Capital|BE|50.87|4.38
Hoofddorp|North Holland|NL|52.3|4.69
Machiques|Zulia|VE|10.06|-72.55
Palakkad|Kerala|IN|10.77|76.65
Silifke|Mersin|TR|36.38|33.93
Charleston|SC|US|32.78|-79.93
Langley|British Columbia|CA|49.1|-122.66
Midland|TX|US|32|-102.08
Fujinomiya|Shizuoka|JP|35.22|138.62
Mingala Tangnyunt|Yangon|MM|16.79|96.17
Innsbruck|Tyrol|AT|47.26|11.39
Braganca|Para|BR|-1.05|-46.77
Kingston|Ontario|CA|44.23|-76.48
Wugang|Hunan|CN|26.73|110.63
Gloucester|England|GB|51.87|-2.24
Waco|TX|US|31.55|-97.15
Cerro|Havana|CU|23.11|-82.38
Zama|Kanagawa|JP|35.49|139.39
Manokwari|West Papua|ID|-0.86|134.06
Valinhos|Sao Paulo|BR|-22.97|-47
Dimitrovgrad|Ulyanovsk|RU|54.21|49.62
Zhalantun|Inner Mongolia|CN|48.01|122.74
Bettiah|Bihar|IN|26.8|84.5
Maijdi|Chittagong|BD|22.87|91.1
Sao Felix do Xingu|Para|BR|-6.64|-51.99
San Pedro Garza Garcia|Nuevo Leon|MX|25.66|-100.4
Sapucaia do Sul|Rio Grande do Sul|BR|-29.82|-51.15
Kombolcha|Amhara|ET|11.08|39.74
Muricay|Zamboanga Peninsula|PH|7.83|123.48
Sterling Heights|MI|US|42.58|-83.03
Surat Thani|Surat Thani|TH|9.14|99.33
Fuerth|Bavaria|DE|49.48|10.99
Ferrara|Emilia-Romagna|IT|44.84|11.62
Quan GJuc Thinh||VN|10.31|105.74
Isidro Casanova|Buenos Aires|AR|-34.7|-58.59
Omuta|Fukuoka|JP|33.03|130.45
Villa Mercedes|Biobio|CL|-37.4|-71.98
Fuji|Sichuan|CN|29.15|105.37
Palwal|Haryana|IN|28.14|77.33
Bielany|Mazovia|PL|52.29|20.94
Dawukou|Ningxia|CN|39.04|106.4
Bulaon|Central Luzon|PH|15.08|120.66
Garut|West Java|ID|-7.25|107.92
Ajdabiya|Al Wahat|LY|30.76|20.23
Abiko|Chiba|JP|35.87|140.02
Kadoma|Osaka|JP|34.74|135.57
Majie|Yunnan|CN|25.03|102.64
Bhakkar|Punjab|PK|31.63|71.06
Rio Pequeno|Sao Paulo|BR|-23.57|-46.76
Kashmar|Razavi Khorasan|IR|35.24|58.47
Jijel|Jijel|DZ|36.82|5.76
Martapura|South Kalimantan|ID|-3.41|114.86
Villeurbanne|Auvergne-Rhone-Alpes|FR|45.77|4.88
Hai Chau|Da Nang City|VN|15.92|108.13
Limbe|South-West|CM|4.02|9.21
Raniganj|West Bengal|IN|23.62|87.13
Hepo|Guangdong|CN|23.43|115.83
Iranshahr|Sistan and Baluchestan|IR|27.2|60.68
Soubre|Bas-Sassandra District|CI|5.78|-6.59
Onomichi|Hiroshima|JP|34.42|133.2
Denton|TX|US|33.21|-97.13
Etah|Uttar Pradesh|IN|27.56|78.66
Pilibhit|Uttar Pradesh|IN|28.63|79.8
Shangzhi|Heilongjiang|CN|45.21|128
Lashio|Shan State|MM|22.94|97.75
Rayon KhTZ|Kharkiv|UA|49.94|36.37
Novomoskovsk|Tula Oblast|RU|54.01|38.29
Matsubara|Osaka|JP|34.57|135.55
Abengourou|Comoe District|CI|6.73|-3.5
Al Bab|Aleppo|SY|36.37|37.52
Shuangcheng|Heilongjiang|CN|45.38|126.31
Exeter|England|GB|50.72|-3.53
Circoiscrizione III|Piedmont|IT|45.06|7.63
Ho|Volta|GH|6.6|0.47
Narowal|Punjab|PK|32.1|74.87
Lao Cai|Lao Cai|VN|22.49|103.97
Al Ajaylat|An Nuqat al Khams|LY|32.76|12.38
Udon Thani|Udon Thani|TH|17.42|102.79
Baharkah|Erbil|IQ|36.32|44.04
Bayan Lepas|Penang|MY|5.3|100.26
Petrogradka|St.-Petersburg|RU|59.97|30.31
Rajapalayam|Tamil Nadu|IN|9.45|77.55
Zipaquira|Cundinamarca|CO|5.02|-74
Jiroft|Kerman|IR|28.68|57.74
Cedar Rapids|IA|US|42.01|-91.64
Dongyang|Zhejiang|CN|29.27|120.23
Nantou|Guangdong|CN|22.72|113.29
Botad|Gujarat|IN|22.17|71.67
Nablus|West Bank|PS|32.22|35.25
New Haven|CT|US|41.31|-72.93
Arcahaie|Ouest|HT|18.77|-72.51
Jiazi|Guangdong|CN|22.88|116.07
Foumban|West|CM|5.73|10.9
Roseville|CA|US|38.75|-121.29
Quilpue|Valparaiso|CL|-33.05|-71.44
Rawson|San Juan|AR|-31.58|-68.54
Sidi Husayn|Tunis Governorate|TN|36.76|10.12
Kati|Koulikoro|ML|12.74|-8.07
Seri Kembangan|Selangor|MY|3.03|101.72
Kembangan||SG|1.32|103.91
Colchester|England|GB|51.89|0.9
Umea|Vaesterbotten|SE|63.83|20.26
Din Daeng|Bangkok|TH|13.79|100.57
Chaman|Balochistan|PK|30.92|66.45
Sennar|Sennar|SD|13.57|33.57
Masaya|Masaya Department|NI|11.97|-86.1
Visalia|CA|US|36.33|-119.29
Nankana Sahib|Punjab|PK|31.45|73.71
Caala|Huambo|AO|-12.85|15.56
Sonargaon|Dhaka Division|BD|23.65|90.62
Dongxing|Guangxi|CN|21.55|107.97
Tottenham|England|GB|51.6|-0.07
Zuglo|Budapest|HU|47.52|19.11
Aley|Mount Lebanon|LB|33.81|35.6
San Martin|Piura|PE|-5.19|-80.67
Tychy|Silesia|PL|50.14|18.97
Ramenki|Moscow|RU|55.7|37.5
Cambridge|Ontario|CA|43.36|-80.31
Mardin|Mardin|TR|37.31|40.74
Pingxiang|Guangxi|CN|22.1|106.76
Zwolle|Overijssel|NL|52.51|6.09
Baidoa|Bay|SO|3.11|43.65
Sam Son|Thanh Hoa Province|VN|19.73|105.9
Santo Antonio|Guangdong|CN|22.2|113.54
Salford|England|GB|53.49|-2.29
Mandi Bahauddin|Punjab|PK|32.59|73.49
Tokat|Tokat Province|TR|40.31|36.55
Erebuni|Yerevan|AM|40.13|44.53
O Mon|Can Tho City|VN|10.11|105.62
Gapan|Central Luzon|PH|15.31|120.95
Deoria|Uttar Pradesh|IN|26.5|83.78
Bayambang|Ilocos|PH|15.81|120.46
Mianwali|Punjab|PK|32.58|71.53
Coral Springs|FL|US|26.27|-80.27
Sherbrooke|Quebec|CA|45.4|-71.9
Al Bayda'|Al Jabal al Akhdar|LY|32.76|21.76
Jardim Helena|Sao Paulo|BR|-23.48|-46.41
Sabara|Minas Gerais|BR|-19.89|-43.81
Acilia-Castel Fusano-Ostia Antica|Lazio|IT|41.76|12.33
Charlottenburg|State of Berlin|DE|52.52|13.28
Thousand Oaks|CA|US|34.17|-118.84
Columbia|MO|US|38.95|-92.33
Colatina|Espirito Santo|BR|-19.54|-40.63
Gyor|Gyor-Moson-Sopron|HU|47.68|17.64
Copiapo|Atacama|CL|-27.37|-70.33
Kokubunji|Tokyo|JP|35.7|139.48
Quibdo|Choco|CO|5.69|-76.66
Guelmim|Guelmim-Oued Noun|MA|28.99|-10.06
Charallave|Miranda|VE|10.24|-66.86
Shahr-e Kord|Chaharmahal and Bakhtiari|IR|32.33|50.86
Malambo|Atlantico|CO|10.86|-74.77
Tatui|Sao Paulo|BR|-23.36|-47.86
Iwakuni|Yamaguchi|JP|34.16|132.22
Leiyang|Hunan|CN|26.4|112.86
Bialoleka|Mazovia|PL|52.32|20.97
Cadiz|Western Visayas|PH|10.95|123.29
Carnot|Mambere|CF|4.94|15.88
Bat Yam|Tel Aviv|IL|32.02|34.75
Zacatecas|Zacatecas|MX|22.77|-102.58
Elizabeth|NJ|US|40.66|-74.21
Zyablikovo|Moscow|RU|55.62|37.77
Daur|Sindh|PK|26.46|68.32
Bingoel|Bingoel|TR|38.88|40.49
Copacabana|Rio de Janeiro|BR|-22.97|-43.19
Satkhira|Khulna Division|BD|22.71|89.07
Parung|West Java|ID|-6.42|106.73
Palo Negro|Aragua|VE|10.17|-67.54
Stamford|CT|US|41.05|-73.54
Idlib|Idlib|SY|35.93|36.63
Moanda|Bas-Congo|CD|-5.93|12.37
Sinah|Duhok|IQ|36.81|43.04
Osaki|Miyagi|JP|38.59|140.97
Magelang|Central Java|ID|-7.47|110.22
Concord|CA|US|37.98|-122.03
Leiria|Leiria|PT|39.74|-8.81
Puno|Puno|PE|-15.84|-70.02
Kamyshin|Volgograd Oblast|RU|50.09|45.41
Shuanglonghu|Chongqing|CN|29.72|106.61
Nimach|Rajasthan|IN|24.46|74.87
Kafr ad Dawwar|Beheira|EG|31.13|30.13
Aguas Claras|Federal District|BR|-15.84|-48.03
Bosque Saude|Sao Paulo|BR|-23.61|-46.62
Novocheboksarsk|Chuvash Republic|RU|56.11|47.48
Besancon|Bourgogne-Franche-Comte|FR|47.25|6.02
Lugazi|Central Region|UG|0.37|32.94
Thanh pho Song Cong|Thai Nguyen|VN|21.48|105.84
Rosario|Calabarzon|PH|13.63|121.22
Khardah|West Bengal|IN|22.72|88.38
Sakakah|Al Jawf Region|SA|29.97|40.21
Khenifra|Beni Mellal-Khenifra|MA|32.93|-5.66
Al Manaqil|Al Jazirah|SD|14.25|32.99
Rustavi|Kvemo Kartli|GE|41.56|44.98
Jose Bonifacio|Sao Paulo|BR|-23.57|-46.43
Manzanillo|Granma Province|CU|20.34|-77.12
Yavatmal|Maharashtra|IN|20.39|78.13
Halisahar|West Bengal|IN|22.93|88.42
Serpukhov|Moscow Oblast|RU|54.92|37.42
Rionegro|Antioquia|CO|6.16|-75.37
Shache|Xinjiang|CN|38.42|77.24
Siheungdong|Seoul|KR|37.45|126.91
Khanna|Punjab|IN|30.71|76.22
Koidu|Eastern Province|SL|8.64|-10.97
Norman|OK|US|35.22|-97.44
Mosquera|Cundinamarca|CO|4.71|-74.23
Orekhovo-Borisovo Severnoye|Moscow|RU|55.62|37.68
Ivanovskoye|Moscow|RU|55.77|37.83
Bento Goncalves|Rio Grande do Sul|BR|-29.17|-51.52
Buon Ho|Dak Lak|VN|12.95|108.3
Chu|Bac Ninh|VN|21.37|106.57
Vaesteras|Vaestmanland|SE|59.62|16.55
Seto|Aichi|JP|35.23|137.1
Alhambra|AZ|US|33.5|-112.13
Titagarh|West Bengal|IN|22.74|88.37
Newcastle under Lyme|England|GB|53|-2.23
Opole|Opole Voivodeship|PL|50.67|17.93
Worcester|Western Cape|ZA|-33.65|19.45
Elblag|Warmia-Masuria|PL|54.15|19.41
Gaojing|Shanghai|CN|31.32|121.48
Sirajganj|Rajshahi Division|BD|24.46|89.71
Jequie|Bahia|BR|-13.86|-40.09
Plock|Mazovia|PL|52.55|19.71
Siguatepeque|Comayagua Department|HN|14.6|-87.83
Walbrzych|Lower Silesia|PL|50.77|16.28
Yevlakh|Yevlax City|AZ|40.62|47.15
Mykilska Borshchahivka|Kyiv City|UA|50.43|30.37
Al Manzalah|Dakahlia|EG|31.16|31.94
Wau|Western Bahr al Ghazal|SS|7.7|27.99
Songnan|Shanghai|CN|31.35|121.48
Soedermalm|Stockholm|SE|59.31|18.08
Athens|GA|US|33.96|-83.38
Amaigbo|Abia State|NG|5.79|7.84
Vila Mariana|Sao Paulo|BR|-23.59|-46.63
Chiang Mai|Chiang Mai|TH|18.79|98.98
Lafia|Nasarawa State|NG|8.49|8.52
Jiangyou|Sichuan|CN|31.77|104.72
Cikampek|West Java|ID|-6.42|107.46
Mustafabad|Delhi|IN|28.72|77.27
Tengyue|Yunnan|CN|24.99|98.51
Shajing|Guangdong|CN|22.75|113.82
Jinfeng|Jiangxi|CN|28.24|116.6
Sancti Spiritus|Sancti Spiritus Province|CU|21.93|-79.44
Mataro|Catalonia|ES|41.54|2.44
Barretos|Sao Paulo|BR|-20.56|-48.57
Kent|WA|US|47.38|-122.23
Pakokku|Magway|MM|21.33|95.08
Murom|Vladimir Oblast|RU|55.57|42.02
Daska Kalan|Punjab|PK|32.32|74.35
Sertaozinho|Sao Paulo|BR|-21.14|-47.99
Hathras|Uttar Pradesh|IN|27.6|78.05
Pulong Santa Cruz|Calabarzon|PH|14.27|121.08
Klaten|Central Java|ID|-7.71|110.61
Khasavyurt|Dagestan|RU|43.25|46.59
Neftekamsk|Bashkortostan Republic|RU|56.09|54.26
Villaverde|Madrid|ES|40.35|-3.7
Simi Valley|CA|US|34.27|-118.78
Bayawan|Central Visayas|PH|9.36|122.8
Shakargarh|Punjab|PK|32.26|75.16
Jorhat|Assam|IN|26.76|94.2
Santa Cruz|National Capital Region|PH|14.6|120.98
La Victoria|Aragua|VE|10.23|-67.33
Pakpattan|Punjab|PK|30.34|73.39
Jingzhi|Shandong|CN|36.31|119.39
Danshui|Guangdong|CN|22.8|114.47
Circoiscrizione V|Piedmont|IT|45.1|7.66
Solihull|England|GB|52.41|-1.78
East Los Angeles|CA|US|34.02|-118.17
Lalitpur|Uttar Pradesh|IN|24.69|78.42
Jombang|East Java|ID|-7.55|112.23
Maxixe|Inhambane Province|MZ|-23.86|35.35
Nakhon Ratchasima|Nakhon Ratchasima|TH|14.97|102.1
Chinandega|Chinandega Department|NI|12.63|-87.13
Al Jadid|Sabha District|LY|27.05|14.4
Lambare|Central Department|PY|-25.35|-57.61
Iizuka|Fukuoka|JP|33.64|130.69
Hua Hin|Prachuap Khiri Khan|TH|12.57|99.96
San Carlos del Zulia|Zulia|VE|9|-71.93
Vilkhivskyi|Luhansk|UA|48.54|39.28
Rafah|Gaza Strip|PS|31.3|34.24
Ampang|Kuala Lumpur|MY|3.15|101.77
Guntakal|Andhra Pradesh|IN|15.17|77.36
Ala'er|Xinjiang|CN|40.54|81.27
Santa Clara|CA|US|37.35|-121.96
Pithampur|Madhya Pradesh|IN|22.6|75.7
Paseh|West Java|ID|-7.07|107.79
Mothihari|Bihar|IN|26.65|84.92
Koganei|Tokyo|JP|35.7|139.51
Retiro|Madrid|ES|40.41|-3.68
Nossa Senhora de Fatima|Guangdong|CN|22.21|113.55
Sunset Park|NY|US|40.65|-74.01
Topeka|KS|US|39.05|-95.68
Orleans|Ontario|CA|45.46|-75.5
Paek'ak|South Pyongan|KP|39.46|125.61
Huicheng|Guangdong|CN|23.04|116.29
Puerto Ayacucho|Amazonas|VE|5.66|-67.58
Gashua|Yobe State|NG|12.87|11.04
Les Cayes|Sud|HT|18.19|-73.75
Salerno|Campania|IT|40.68|14.79
Savannakhet|Savannakhet Province|LA|16.57|104.76
Munuf|Monufia|EG|30.47|30.93
Watford|England|GB|51.66|-0.4
Guara|Federal District|BR|-15.81|-47.97
Giresun|Giresun|TR|40.92|38.39
Xiazhen|Shandong|CN|34.8|117.11
Chaeryong-ni|South Pyongan|KP|38.74|125.23
Kastamonu|Kastamonu|TR|41.38|33.78
Kanhangad|Kerala|IN|12.31|75.11
'Ajlun|Ajloun|JO|32.33|35.75
Derince|Kocaeli|TR|40.76|29.81
Sukawati|Bali|ID|-8.49|115.05
Jagdalpur|Chhattisgarh|IN|19.08|82.02
Kuopio|North Savo|FI|62.89|27.68
Bang Sue|Bangkok|TH|13.81|100.53
Mailsi|Punjab|PK|29.8|72.17
Los Angeles|Biobio|CL|-37.47|-72.35
Haimen|Guangdong|CN|23.19|116.61
Karabuek|Karabuek Province|TR|41.2|32.63
Ntuzuma|KwaZulu-Natal|ZA|-29.74|30.95
Tsuruoka|Yamagata|JP|38.72|139.82
Saint Peters|England|GB|51.37|1.42
Barbacena|Minas Gerais|BR|-21.23|-43.77
Uruma|Okinawa|JP|26.38|127.86
Debre Tabor|Amhara|ET|11.85|38.02
Sakiet ed Daier|Sfax Governorate|TN|34.79|10.81
Nzega|Tabora|TZ|-4.22|33.18
Abilene|TX|US|32.45|-99.73
Ban Samae Dam|Bangkok|TH|13.59|100.39
Shahecheng|Hebei|CN|36.94|114.51
Kumbo|North-West|CM|6.2|10.67
Ottawa South|Ontario|CA|45.39|-75.69
Willemstad||CW|12.12|-68.89
Balti|Balti|MD|47.76|27.93
Dokri|Sindh|PK|27.37|68.1
Tyoply Stan|Moscow|RU|55.62|37.49
Az Zulfi|Riyadh Region|SA|26.3|44.82
Sultan Kudarat|Autonomous Region in Muslim Mindanao|PH|7.23|124.26
Bet Shemesh|Jerusalem|IL|31.73|34.99
Jagadhri|Haryana|IN|30.17|77.3
Huixquilucan|Mexico|MX|19.36|-99.35
Arapongas|Parana|BR|-23.42|-51.42
Semnan|Semnan|IR|35.58|53.39
Leon|Castille and Leon|ES|42.6|-5.57
San Francisco de Macoris|Duarte Province|DO|19.29|-70.25
Yushu|Jilin|CN|44.83|126.54
Yuanlin|Taiwan|TW|23.96|120.58
Santa Tecla|La Libertad Department|SV|13.68|-89.28
Sorriso|Mato Grosso|BR|-12.55|-55.71
Ciudad Valles|San Luis Potosi|MX|22|-99.01
Ouahigouya|Nord|BF|13.58|-2.42
Poblacion|National Capital Region|PH|14.38|121.03
Kashihara-shi|Nara|JP|34.51|135.79
Ashmun|Monufia|EG|30.3|30.98
Agri|Agri|TR|39.71|43.04
Leeuwarden|Friesland|NL|53.2|5.81
Ben Tre|Vinh Long|VN|10.24|106.38
Monza|Lombardy|IT|45.58|9.27
New Mirpur City|Azad Kashmir|PK|33.15|73.75
Chia|Cundinamarca|CO|4.86|-74.06
Olanchito|Yoro Department|HN|15.48|-86.57
Koreatown|CA|US|34.06|-118.3
Targowek|Mazovia|PL|52.29|21.05
Lecheng|Guangdong|CN|25.13|113.35
Nancun|Shandong|CN|36.53|120.13
Marand|East Azerbaijan|IR|38.43|45.77
As Sinbillawayn|Dakahlia|EG|30.88|31.46
Crawley|England|GB|51.11|-0.18
Rudnyy|Kostanay|KZ|52.97|63.11
Magangue|Bolivar|CO|9.24|-74.75
Itaguai|Rio de Janeiro|BR|-22.85|-43.78
Bemowo|Mazovia|PL|52.25|20.91
Metz|Grand Est|FR|49.12|6.17
Jiupu|Liaoning|CN|41.07|122.95
Darjiling|West Bengal|IN|27.03|88.27
Baoshan|Heilongjiang|CN|46.57|131.39
Salvaleon de Higueey|La Altagracia Province|DO|18.62|-68.71
Butanta|Sao Paulo|BR|-23.57|-46.73
Thaton|Mon|MM|16.92|97.37
Budapest III. keruelet|Budapest|HU|47.54|19.05
Kurichchi|Tamil Nadu|IN|10.96|76.97
Lumajang|East Java|ID|-8.13|113.22
Ise|Mie|JP|34.48|136.7
Hagonoy|Central Luzon|PH|14.83|120.73
Samandag|Hatay|TR|36.08|35.98
Caraguatatuba|Sao Paulo|BR|-23.62|-45.41
Birigui|Sao Paulo|BR|-21.29|-50.34
Pinsk|Brest|BY|52.12|26.07
Telde|Canary Islands|ES|27.99|-15.42
Indramayu|West Java|ID|-6.33|108.32
Relizane|Relizane|DZ|35.74|0.56
Bordj el Kiffan|Algiers|DZ|36.75|3.19
Manas|Jalal-Abad Region|KG|40.94|72.99
Kirishima|Kagoshima|JP|31.74|130.76
Orizaba|Veracruz|MX|18.85|-97.1
Luoyang|Guangdong|CN|23.16|114.27
Toba Tek Singh|Punjab|PK|30.97|72.48
Honmachi|Kumamoto|JP|32.5|130.6
Wolfsburg|Lower Saxony|DE|52.42|10.78
Umuarama|Parana|BR|-23.77|-53.33
Niihama|Ehime|JP|33.96|133.31
Jiaohe|Jilin|CN|43.72|127.33
Igarassu|Pernambuco|BR|-7.83|-34.91
Tsaritsyno|Moscow|RU|55.63|37.65
Dos Hermanas|Andalusia|ES|37.28|-5.92
Ajapnyak|Yerevan|AM|40.2|44.47
Tabuk|Cordillera|PH|17.41|121.44
Dam Dam|West Bengal|IN|22.63|88.42
Hoima|Western Region|UG|1.43|31.35
Wuda|Inner Mongolia|CN|39.5|106.71
Az Zubayr|Basra|IQ|30.39|47.7
Schoeneberg|State of Berlin|DE|52.5|13.34
Beppu|Oita|JP|33.28|131.5
Hardoi|Uttar Pradesh|IN|27.39|80.13
Behbahan|Khuzestan|IR|30.6|50.24
Itatiba|Sao Paulo|BR|-23.01|-46.84
Huangzhou|Hubei|CN|30.45|114.8
Sheepshead Bay|NY|US|40.59|-73.94
Puruliya|West Bengal|IN|23.33|86.36
Ubon Ratchathani|Ubon Ratchathani|TH|15.24|104.85
Virginia|Free State|ZA|-28.1|26.87
Brits|North West|ZA|-25.63|27.78
Recklinghausen|North Rhine-Westphalia|DE|51.61|7.2
Zhoucun|Shandong|CN|36.82|117.82
Cherkessk|Karachayevo-Cherkesiya Republic|RU|44.22|42.05
Haveli Lakha|Punjab|PK|30.45|73.69
Maastricht|Limburg|NL|50.85|5.69
Amherst|NY|US|42.98|-78.8
Tekirdag|Tekirdag|TR|40.98|27.51
Shahr-e Sadra|Fars|IR|29.8|52.5
Victorville|CA|US|34.54|-117.29
Burton upon Trent|England|GB|52.81|-1.64
Calumpit|Central Luzon|PH|14.92|120.77
Lat Phrao|Bangkok|TH|13.8|100.61
Livoberezhnyi|Donetsk|UA|47.11|37.64
Goettingen|Lower Saxony|DE|51.53|9.93
Titiwangsa|Kuala Lumpur|MY|3.18|101.7
Phasi Charoen|Bangkok|TH|13.71|100.44
Veshnyaki|Moscow|RU|55.72|37.82
Presnenskiy|Moscow|RU|55.76|37.56
Zabol|Sistan and Baluchestan|IR|31.03|61.49
Kaya|Centre-Nord|BF|13.09|-1.08
Xiangcheng|Yunnan|CN|25.47|100.56
Dharmavaram|Andhra Pradesh|IN|14.41|77.72
Gokalpur|Delhi|IN|28.7|77.29
Adigrat|Tigray|ET|14.28|39.46
Kotamobagu|North Sulawesi|ID|0.74|124.31
Carora|Lara|VE|10.17|-70.08
Vallejo|CA|US|38.1|-122.26
Bhadreswar|West Bengal|IN|22.82|88.34
Dorud|Lorestan Province|IR|33.49|49.06
Bern|Bern|CH|46.95|7.45
San Pedro de la Paz|Biobio|CL|-36.84|-73.1
Nagaon|Assam|IN|26.35|92.67
Lahti|Paijat-Hame|FI|60.98|25.66
Vejalpur|Gujarat|IN|22.69|73.56
Longshui|Chongqing|CN|29.57|105.76
Siracusa|Sicily|IT|37.08|15.29
Mubende|Central Region|UG|0.56|31.39
Stara Zagora|Stara Zagora|BG|42.43|25.64
Ondjiva|Cunene|AO|-17.07|15.73
Alberton|Gauteng|ZA|-26.27|28.12
Gracia|Catalonia|ES|41.4|2.16
Chikmagalur|Karnataka|IN|13.32|75.77
Ekibastuz|Pavlodar Region|KZ|51.72|75.32
Algeciras|Andalusia|ES|36.13|-5.45
Lafayette|LA|US|30.22|-92.02
Lianhe|Heilongjiang|CN|47.13|129.27
Chico|CA|US|39.73|-121.84
Bhadrak|Odisha|IN|21.05|86.52
Bage|Rio Grande do Sul|BR|-31.33|-54.11
North Stamford|CT|US|41.14|-73.54
Bergamo|Lombardy|IT|45.7|9.67
Ruse|Ruse|BG|43.85|25.95
Sawai Madhopur|Rajasthan|IN|26.02|76.34
Chon Thanh|Dong Nai|VN|11.43|106.64
Ambikapur|Chhattisgarh|IN|23.12|83.2
Eunapolis|Bahia|BR|-16.38|-39.58
Apalit|Central Luzon|PH|14.95|120.77
Hartford|CT|US|41.76|-72.69
Bukittinggi|West Sumatra|ID|-0.31|100.37
Dolisie|Niari|CG|-4.2|12.67
Zyuzino|Moscow|RU|55.66|37.57
Ejido|Merida|VE|8.55|-71.24
Berkeley|CA|US|37.87|-122.27
Nova Lima|Minas Gerais|BR|-19.99|-43.85
Plaridel|Central Luzon|PH|14.89|120.86
West Palm Beach|FL|US|26.72|-80.05
Kashiwara|Nara|JP|34.45|135.77
Uruguaiana|Rio Grande do Sul|BR|-29.75|-57.09
Ikoma|Nara|JP|34.68|135.7
Heilbronn|Baden-Wurttemberg|DE|49.14|9.22
El Mourouj|Ben Arous Governorate|TN|36.71|10.21
Tuz Khurmatu|Salah ad Din|IQ|34.89|44.63
Trento|Trentino-Alto Adige|IT|46.07|11.12
Shahdad Kot|Sindh|PK|27.85|67.91
Catchiungo|Huambo|AO|-12.57|16.23
Ingolstadt|Bavaria|DE|48.77|11.42
Toa Payoh New Town||SG|1.34|103.85
Lichuan|Hubei|CN|30.3|108.85
Bukit Bintang|Kuala Lumpur|MY|3.15|101.71
La Concepcion|Zulia|VE|10.62|-71.84
Ulm|Baden-Wurttemberg|DE|48.4|9.99
Mandoli|Delhi|IN|28.7|77.31
San Carlos|Cojedes|VE|9.66|-68.59
Wloclawek|Kujawsko-Pomorskie|PL|52.65|19.07
Allentown|PA|US|40.61|-75.49
Satara|Maharashtra|IN|17.69|73.99
Bao'an Centre|Guangdong|CN|22.58|113.92
Charsadda|Khyber Pakhtunkhwa|PK|34.15|71.74
Fernando de la Mora|Central Department|PY|-25.34|-57.52
Churu|Rajasthan|IN|28.3|74.97
Perugia|Umbria|IT|43.11|12.39
Gangapur|Rajasthan|IN|26.47|76.72
Zhujing|Shanghai|CN|30.9|121.16
Bo GJe|Hanoi|VN|21.06|105.87
Guelma|Guelma|DZ|36.46|7.43
International City|Dubai|AE|25.16|55.41
Dubai Marina|Dubai|AE|25.09|55.15
Zhaoyuan|Shandong|CN|37.36|120.41
Nabatiye et Tahta|Nabatieh|LB|33.38|35.48
Rustaq|Al Batinah South|OM|23.39|57.42
Solntsevo|Moscow|RU|55.64|37.38
Orekhovo-Zuyevo|Moscow Oblast|RU|55.81|38.99
Gereida|Southern Darfur|SD|11.28|25.14
Cabudwaaq|Galguduud|SO|6.25|46.22
Cheremushky|Odesa|UA|46.43|30.71
Madhyapur Thimi|Bagmati Province|NP|27.68|85.39
Saint-Louis-de-Terrebonne|Quebec|CA|45.7|-73.79
Evansville|IN|US|37.97|-87.56
Bonon|Sassandra-Marahoue|CI|6.93|-6.05
Bottrop|North Rhine-Westphalia|DE|51.52|6.93
Ghotki|Sindh|PK|28|69.32
Kwekwe|Midlands Province|ZW|-18.93|29.81
Malindi|Kilifi County|KE|-3.22|40.12
Ban I Chang|Ratchaburi|TH|13.71|99.9
Rize|Rize Province|TR|41.02|40.52
Almirante Tamandare|Parana|BR|-25.32|-49.31
Palm Bay|FL|US|28.03|-80.59
Ann|Rakhine|MM|19.8|94.05
Leiden|South Holland|NL|52.16|4.49
Thon Buri|Bangkok|TH|13.72|100.49
Ajax|Ontario|CA|43.85|-79.03
Bergedorf|Hamburg|DE|53.48|10.23
Sambrial|Punjab|PK|32.48|74.35
Pescara|Abruzzo|IT|42.46|14.2
Modakeke|Osun State|NG|7.38|4.26
Nobeoka|Miyazaki|JP|32.58|131.67
Silang|Calabarzon|PH|14.22|120.97
Amanfrom|Greater Accra|GH|5.54|-0.4
Marituba|Para|BR|-1.36|-48.34
Paulo Afonso|Bahia|BR|-9.41|-38.21
Mohammad Shahr|Alborz Province|IR|35.76|50.92
Izeh|Khuzestan|IR|31.83|49.87
Nazilli|Aydin|TR|37.92|28.32
Daito|Osaka|JP|34.71|135.62
Hoa Cuong|Da Nang City|VN|16.04|108.18
Lira|Northern Region|UG|2.25|32.9
Pforzheim|Baden-Wurttemberg|DE|48.88|8.7
Salihli|Manisa|TR|38.48|28.15
Arabkir|Yerevan|AM|40.21|44.5
Port Dickson|Negeri Sembilan|MY|2.52|101.8
Berkane|Oriental|MA|34.92|-2.32
Catanduva|Sao Paulo|BR|-21.14|-48.97
Dordrecht|South Holland|NL|51.81|4.67
Battambang|Battambang|KH|13.1|103.2
Offenbach|Hesse|DE|50.1|8.77
Kitami|Hokkaido|JP|43.8|143.89
Vinh Yen|Phu Tho|VN|21.31|105.6
Madhavaram|Tamil Nadu|IN|13.15|80.23
Cagua|Aragua|VE|10.19|-67.46
Fujairah|Fujairah|AE|25.12|56.34
Mandimba|Niassa Province|MZ|-14.35|35.65
Reykjavik|Capital Region|IS|64.14|-21.9
Dohad|Gujarat|IN|22.83|74.26
Cheltenham|England|GB|51.9|-2.08
Huaraz|Ancash|PE|-9.53|-77.53
Santa Coloma de Gramenet|Catalonia|ES|41.45|2.21
Santana|Amapa|BR|-0.04|-51.17
Araxa|Minas Gerais|BR|-19.59|-46.94
Piraquara|Parana|BR|-25.44|-49.07
Barshi|Maharashtra|IN|18.23|75.69
Bac Quang|Tuyen Quang|VN|22.48|104.87
Xunchang|Sichuan|CN|28.45|104.71
Hung Yen|Hung Yen Province|VN|20.65|106.05
Miramar|Tamaulipas|MX|22.36|-97.9
Bremerhaven|Bremen|DE|53.55|8.58
Queenstown|Eastern Cape|ZA|-31.9|26.88
Nanbin|Chongqing|CN|30|108.11
Bandar-e Anzali|Gilan Province|IR|37.47|49.46
Khlong Luang|Pathum Thani|TH|14.06|100.65
Adilabad|Telangana|IN|19.67|78.54
Fargo|ND|US|46.88|-96.79
Brugge|Flanders|BE|51.21|3.22
Jhunjhunun|Rajasthan|IN|28.13|75.4
Iguala de la Independencia|Guerrero|MX|18.34|-99.54
Sarandi|Parana|BR|-23.44|-51.87
Zomba|Southern Region|MW|-15.39|35.32
Sepatan|West Java|ID|-6.12|106.58
Malita|Davao Region|PH|6.42|125.61
Zielona Gora|Lubusz|PL|51.94|15.51
Luodian|Shanghai|CN|31.42|121.33
Jetpur|Gujarat|IN|21.75|70.62
Tsentralno-Miskyi|Donetsk|UA|48.3|38.03
Uppal Kalan|Telangana|IN|17.41|78.56
Sao Lourenco da Mata|Pernambuco|BR|-8|-35.02
Maghaghah|Minya|EG|28.65|30.84
Pita Kotte|Western Province|LK|6.89|79.9
Guiguinto|Central Luzon|PH|14.83|120.88
Gudivada|Andhra Pradesh|IN|16.44|81
Setubal|Setubal|PT|38.52|-8.89
Torrejon de Ardoz|Madrid|ES|40.46|-3.47
Aizu-Wakamatsu|Fukushima|JP|37.49|139.95
Bama|Borno State|NG|11.52|13.69
Ilobu|Osun State|NG|7.84|4.49
Manolo Fortich|Northern Mindanao|PH|8.37|124.86
Itabira|Minas Gerais|BR|-19.62|-43.23
Kien An|Hai Phong|VN|20.81|106.63
Jandira|Sao Paulo|BR|-23.53|-46.9
Guaratingueta|Sao Paulo|BR|-22.82|-45.19
San Rafael|Mendoza|AR|-34.62|-68.33
Shaoshan|Hunan|CN|27.92|112.52
Troparevo|Moscow|RU|55.66|37.48
Baran|Rajasthan|IN|25.1|76.52
Narmadapuram|Madhya Pradesh|IN|22.75|77.73
Amreli|Gujarat|IN|21.6|71.21
Nakhon Pathom|Nakhon Pathom|TH|13.82|100.04
Manfalut|Asyut|EG|27.31|30.97
Kakegawa|Shizuoka|JP|34.77|138.02
Handa|Aichi|JP|34.88|136.93
Wushan|Chongqing|CN|31.08|109.88
Friedrichshain Bezirk|State of Berlin|DE|52.52|13.45
Abomey|Zou|BJ|7.18|1.99
Sokode|Centrale|TG|8.98|1.13
Araguari|Minas Gerais|BR|-18.65|-48.19
Tarnow|Lesser Poland|PL|50.01|20.99
Bangkok Noi|Bangkok|TH|13.76|100.48
Jalingo|Taraba State|NG|8.89|11.36
Raposo Tavares|Sao Paulo|BR|-23.59|-46.79
Saanich|British Columbia|CA|48.55|-123.37
Ibanda|Western Region|UG|-0.13|30.5
Bairro da Penha|Sao Paulo|BR|-23.37|-46.31
Nyiregyhaza|Szabolcs-Szatmar-Bereg|HU|47.96|21.72
Sano|Tochigi|JP|36.32|139.58
Karatsu|Saga|JP|33.44|129.97
Achinsk|Krasnoyarsk Krai|RU|56.27|90.5
Pudukkottai|Tamil Nadu|IN|10.38|78.82
Shunyi|Beijing|CN|40.12|116.65
Rotherham|England|GB|53.43|-1.36
Ciudad de Villa de Alvarez|Colima|MX|19.27|-103.74
Rouiba|Algiers|DZ|36.74|3.28
Banyuwangi|East Java|ID|-8.23|114.36
Tebingtinggi|North Sumatra|ID|3.33|99.16
Tigwav|Ouest|HT|18.43|-72.87
Narasaraopet|Andhra Pradesh|IN|16.23|80.05
Lisala|Mongala|CD|2.15|21.52
Badin|Sindh|PK|24.66|68.84
Banfora|Cascades Region|BF|10.64|-4.75
Punta Arenas|Region of Magallanes|CL|-53.16|-70.91
Kadoma|Mashonaland West|ZW|-18.33|29.92
Midsayap|Soccsksargen|PH|7.19|124.53
Camboriu|Santa Catarina|BR|-27.03|-48.65
Pyin Oo Lwin|Mandalay Region|MM|22.04|96.46
Clearwater|FL|US|27.97|-82.8
Himamaylan|Western Visayas|PH|10.1|122.87
Independence|MO|US|39.09|-94.42
Heroica Guaymas|Sonora|MX|27.92|-110.9
Kedungwuni|Central Java|ID|-6.97|109.65
Ilebo|Kasai|CD|-4.33|20.59
Kristiansand|Agder|NO|58.15|8
Longjing|Jilin|CN|42.77|129.42
Kroonstad|Free State|ZA|-27.65|27.23
Remscheid|North Rhine-Westphalia|DE|51.18|7.19
Billings|MT|US|45.78|-108.5
Moeng Yang|Shan State|MM|21.85|99.68
Cacak|Central Serbia|RS|43.89|20.35
Ann Arbor|MI|US|42.28|-83.74
Los Banos|Calabarzon|PH|14.17|121.24
Duekoue|Montagnes|CI|6.74|-7.35
Higashikurume|Tokyo|JP|35.75|139.51
Rishra|West Bengal|IN|22.72|88.35
Pinhais|Parana|BR|-25.44|-49.19
Kyzyl|Republic of Tyva|RU|51.71|94.44
Cadiz|Andalusia|ES|36.53|-6.29
Dabrowa Gornicza|Silesia|PL|50.33|19.2
Passos|Minas Gerais|BR|-20.72|-46.61
Faqus|Sharqia|EG|30.73|31.8
Tacurong|Soccsksargen|PH|6.69|124.68
Hofu|Yamaguchi|JP|34.05|131.57
Gabela|Kwanza Sul|AO|-10.85|14.38
Serangoon||SG|1.36|103.9
Serangoon New Town||SG|1.35|103.87
Funza|Cundinamarca|CO|4.72|-74.21
Merauke|South Papua|ID|-8.5|140.41
Baripada|Odisha|IN|21.93|86.73
Konosu|Saitama|JP|36.07|139.52
Soreang|West Java|ID|-7.03|107.52
Smolyanskyi|Donetsk|UA|48.01|37.74
Noord|North Holland|NL|52.39|4.91
Dinaig|Autonomous Region in Muslim Mindanao|PH|7.17|124.21
Manp'o|Chagang|KP|41.15|126.29
Muktsar|Punjab|IN|30.47|74.52
El Monte|CA|US|34.07|-118.03
Tubarao|Santa Catarina|BR|-28.47|-49.01
Forli|Emilia-Romagna|IT|44.22|12.04
Azamgarh|Uttar Pradesh|IN|26.07|83.18
Santa Maria|Federal District|BR|-16.03|-48.03
Masaka|Central Region|UG|-0.33|31.73
Co GJo|Can Tho City|VN|10.09|105.43
Taldykorgan|Zhetysu Region|KZ|45.02|78.37
Moncloa-Aravaca|Madrid|ES|40.44|-3.73
Gulin|Sichuan|CN|28.04|105.81
Al Majaz|Sharjah|AE|25.32|55.39
Thung Khru|Bangkok|TH|13.63|100.51
Barnala|Punjab|IN|30.37|75.55
Yelahanka|Karnataka|IN|13.1|77.6
Pattaya|Chon Buri|TH|12.93|100.88
Chittorgarh|Rajasthan|IN|24.89|74.62
Chenggu|Shaanxi|CN|33.15|107.33
Harlem|NY|US|40.81|-73.95
Orleans|Centre-Val de Loire|FR|47.9|1.9
Rouen|Normandy|FR|49.44|1.1
Tinsukia|Assam|IN|27.49|95.36
Westminster|CO|US|39.84|-105.04
Dasha|Guangdong|CN|23.11|113.44
Yakeshi|Inner Mongolia|CN|49.28|120.73
Ipiranga|Sao Paulo|BR|-23.6|-46.62
Makumbako|Njombe|TZ|-8.85|34.83
Khargone|Madhya Pradesh|IN|21.82|75.61
Mariara|Carabobo|VE|10.3|-67.72
Digos|Davao Region|PH|6.75|125.36
Tshilenge|Lualaba|CD|-10.97|22.9
Ain Beida|Oum el Bouaghi|DZ|35.8|7.39
Shahre Jadide Andisheh|Tehran|IR|35.68|51.02
Andisheh|Tehran|IR|35.75|51.28
Breves|Para|BR|-1.68|-50.48
Alcobendas|Madrid|ES|40.55|-3.64
Kissidougou|Faranah|GN|9.18|-10.1
San Tung Chung Hang|Islands|HK|22.28|113.94
Taganskiy|Moscow|RU|55.73|37.67
Round Rock|TX|US|30.51|-97.68
Noginsk|Moscow Oblast|RU|55.86|38.45
Tinaquillo|Cojedes|VE|9.92|-68.3
Wilmington|NC|US|34.24|-77.95
Cavite City|Calabarzon|PH|14.48|120.9
Campo Grande|Sao Paulo|BR|-23.67|-46.69
East Harlem|NY|US|40.79|-73.94
Formosa|Goias|BR|-15.54|-47.33
Tandil|Buenos Aires|AR|-37.33|-59.14
Zoetermeer|South Holland|NL|52.06|4.49
Sao Goncalo do Amarante|Rio Grande do Norte|BR|-5.79|-35.33
Sri Jayewardenepura Kotte|Western Province|LK|6.88|79.91
Nasushiobara|Tochigi|JP|36.98|140.07
Varzea Paulista|Sao Paulo|BR|-23.21|-46.83
Baisha|Chongqing|CN|29.06|106.12
Bani Mazar|Minya|EG|28.49|30.81
Taunsa|Punjab|PK|30.7|70.65
Urasoe|Okinawa|JP|26.26|127.73
Santana|Sao Paulo|BR|-23.49|-46.64
Yelets|Lipetsk Oblast|RU|52.61|38.51
Suan Luang|Bangkok|TH|13.73|100.65
Parla|Madrid|ES|40.24|-3.77
My Hao|Hung Yen Province|VN|20.92|106.08
Anliu|Guangdong|CN|23.7|115.68
Ribeirao Pires|Sao Paulo|BR|-23.71|-46.41
Recanto das Emas|Federal District|BR|-15.91|-48.06
Chunga|Lusaka Province|ZM|-15.32|28.27
Bishah|'Asir Region|SA|20|42.61
Novo-Peredelkino|Moscow|RU|55.65|37.34
Baidyabati|West Bengal|IN|22.78|88.33
Okigwe|Imo State|NG|5.83|7.35
Ar Rifa'|Southern Governorate|BH|26.13|50.55
Uzhhorod|Zakarpattia|UA|48.62|22.29
Kasese|Western Region|UG|0.18|30.08
Tianfu|Shandong|CN|37.26|122.05
Arvada|CO|US|39.8|-105.09
Otaru|Hokkaido|JP|43.19|141
Tayabas|Calabarzon|PH|14.03|121.59
Inkisi|Bas-Congo|CD|-5.13|15.05
Iriga City|Bicol Region|PH|13.43|123.41
Thornhill|Ontario|CA|43.81|-79.42
Vacoas|Plaines Wilhems|MU|-20.3|57.48
Beaumont|TX|US|30.09|-94.1
Vlore|Vlore County|AL|40.47|19.48
Sanxia|Taipei|TW|24.93|121.37
Provo|UT|US|40.23|-111.66
Tucurui|Para|BR|-3.77|-49.68
Basti|Uttar Pradesh|IN|26.79|82.72
Peoria|IL|US|40.69|-89.59
Ezeiza|Buenos Aires|AR|-34.85|-58.52
Lasnamaee|Harjumaa|EE|59.43|24.86
Xiva|Xorazm Region|UZ|41.39|60.36
Amasya|Amasya|TR|40.65|35.83
Mendoza|Mendoza|AR|-32.89|-68.85
Balkh|Balkh|AF|36.76|66.9
Cubatao|Sao Paulo|BR|-23.89|-46.43
Mingshui|Shandong|CN|36.72|117.5
Vila Medeiros|Sao Paulo|BR|-23.49|-46.58
Phong GJien|Thua Thien Hue Province|VN|16.58|107.36
Nova Serrana|Minas Gerais|BR|-19.88|-44.98
Wang Thonglang|Bangkok|TH|13.79|100.61
Carlsbad|CA|US|33.16|-117.35
Mandera|Mandera County|KE|3.94|41.86
Qiaotou|Qinghai|CN|36.94|101.67
Gyumri|Shirak|AM|40.79|43.85
Silopi|Sirnak|TR|37.24|42.46
Gangavati|Karnataka|IN|15.43|76.53
Ambur|Tamil Nadu|IN|12.79|78.72
Tangara da Serra|Mato Grosso|BR|-14.62|-57.49
Gorzow Wielkopolski|Lubusz|PL|52.73|15.23
Simoes Filho|Bahia|BR|-12.78|-38.4
Giridih|Jharkhand|IN|24.19|86.31
Phool Nagar|Punjab|PK|31.2|73.95
Quezon|Northern Mindanao|PH|7.73|125.1
Aryanah|Ariana Governorate|TN|36.86|10.19
Tungipara|Dhaka Division|BD|22.9|89.9
Ichinoseki|Iwate|JP|38.92|141.13
Khenchela|Khenchela|DZ|35.44|7.14
Khon Kaen|Khon Kaen|TH|16.45|102.83
Odessa|TX|US|31.85|-102.37
Catalao|Goias|BR|-18.17|-47.95
Tando Muhammad Khan|Sindh|PK|25.12|68.54
Springfield|IL|US|39.8|-89.64
Somaroboro|Mpumalanga|ZA|-25.35|28.83
Guadalajara de Buga|Valle del Cauca Department|CO|3.9|-76.3
Pamanukan|West Java|ID|-6.28|107.81
Codo|Maranhao|BR|-4.46|-43.89
Pardis|Tehran|IR|35.75|51.81
Pleiku|Gia Lai|VN|13.98|108
Downey|CA|US|33.94|-118.13
Lower Hutt|Wellington Region|NZ|-41.22|174.92
Yuyao|Zhejiang|CN|30.05|121.15
Ranyah|Sulaymaniyah|IQ|36.26|44.88
Hatsukaichi|Hiroshima|JP|34.35|132.33
Tung Chung|Islands|HK|22.29|113.94
Salto|Salto Department|UY|-31.39|-57.96
Siirt|Siirt|TR|37.93|41.94
Korolyov|Zhytomyr Oblast|UA|50.24|28.7
Zhaozhou|Heilongjiang|CN|45.71|125.27
Villa Lugano|Buenos Aires F.D.|AR|-34.68|-58.47
Ochakovo-Matveyevskoye|Moscow|RU|55.68|37.45
Punta Cardon|Falcon|VE|11.66|-70.22
Akishima|Tokyo|JP|35.72|139.38
Itacoatiara|Amazonas|BR|-3.14|-58.44
Chililabombwe|Copperbelt|ZM|-12.36|27.82
Riviere-des-Prairies-Pointe-aux-Trembles|Quebec|CA|45.64|-73.58
Worthing|England|GB|50.82|-0.38
Navojoa|Sonora|MX|27.07|-109.44
Offa|Kwara State|NG|8.15|4.72
Tobolsk|Tyumen Oblast|RU|58.2|68.25
Tokai|Aichi|JP|35.02|136.91
Wardha|Maharashtra|IN|20.74|78.6
Wansheng|Chongqing|CN|28.96|106.93
Pattoki|Punjab|PK|31.02|73.85
Wayaobu|Shaanxi|CN|37.14|109.66
Hikone|Shiga|JP|35.25|136.25
Nagahama|Shiga|JP|35.38|136.27
Pingshan|Guangdong|CN|22.99|114.71
Songyuan|Jilin|CN|45.13|124.83
Maba|Guangdong|CN|24.68|113.6
Fujimino|Saitama|JP|35.9|139.52
Doncaster|England|GB|53.52|-1.13
Binh Thuy|Can Tho City|VN|10.07|105.74
Dumaguete|Central Visayas|PH|9.31|123.31
Budapest XIII. keruelet|Budapest|HU|47.53|19.08
Nippes|North Rhine-Westphalia|DE|50.97|6.95
Jaen|Andalusia|ES|37.77|-3.79
Chengqiao|Shanghai|CN|31.63|121.39
Chorzow|Silesia|PL|50.31|18.97
Porz am Rhein|North Rhine-Westphalia|DE|50.89|7.06
Louga|Louga|SN|15.62|-16.22
Elmhurst|NY|US|40.74|-73.88
Hoang Mai|Nghe An Province|VN|19.27|105.72
Yaritagua|Yaracuy|VE|10.08|-69.12
Shahdadpur|Sindh|PK|25.93|68.62
Itumbiara|Goias|BR|-18.42|-49.22
Khwisero|Kakamega County|KE|0.17|34.59
Costa Mesa|CA|US|33.64|-117.92
Jauharabad|Punjab|PK|32.29|72.28
Miami Gardens|FL|US|25.94|-80.25
Bagram|Parwan|AF|34.97|69.27
Chesterfield|England|GB|53.25|-1.42
North Peoria|IL|US|40.72|-89.58
Shchyolkovo|Moscow Oblast|RU|55.92|37.97
Al Fashn|Beni Suweif|EG|28.82|30.9
Fairfield|CA|US|38.25|-122.04
Guanabacoa|Havana|CU|23.13|-82.3
Hammanskraal|North West|ZA|-25.41|28.29
Oshu|Iwate|JP|39.14|141.17
Taourirt|Oriental|MA|34.41|-2.9
Talkha|Dakahlia|EG|31.05|31.38
Neili|Taiwan|TW|24.97|121.26
Vihari|Punjab|PK|30.04|72.36
Taonan|Jilin|CN|45.33|122.78
Youkaichi|Shiga|JP|35.12|136.2
Kazo|Saitama|JP|36.12|139.6
Santa Lucia Cotzumalguapa|Escuintla|GT|14.34|-91.02
Joenkoeping|Joenkoeping|SE|57.78|14.16
City of Port Phillip|Victoria|AU|-37.83|144.94
Tadepalligudem|Andhra Pradesh|IN|16.81|81.53
Haikou|Yunnan|CN|24.78|102.58
Lansing|MI|US|42.73|-84.56
Chanduasi|Uttar Pradesh|IN|28.45|78.78
Bagaha|Bihar|IN|27.1|84.09
Nefteyugansk|Khanty-Mansia|RU|61.1|72.6
Reutlingen|Baden-Wurttemberg|DE|48.49|9.2
Bushwick|NY|US|40.69|-73.92
Upata|Bolivar|VE|8.02|-62.41
Shaowu|Fujian|CN|27.34|117.48
Mengmao|Yunnan|CN|24|97.86
Lawang|East Java|ID|-7.84|112.69
Bouskoura|Casablanca-Settat|MA|33.45|-7.65
Satu Mare|Satu Mare County|RO|47.8|22.86
Itanhaem|Sao Paulo|BR|-24.18|-46.79
Kaiyuan|Liaoning|CN|42.53|124.04
Kisii|Kisii County|KE|-0.68|34.77
Petrzalka|Bratislava Region|SK|48.12|17.13
Kazerun|Fars|IR|29.62|51.65
Ermelino Matarazzo|Sao Paulo|BR|-23.49|-46.47
Achalpur|Maharashtra|IN|21.26|77.51
Planaltina|Goias|BR|-15.45|-47.61
Guanare|Portuguesa|VE|9.04|-69.73
Wuzhishan|Hainan|CN|18.78|109.5
Gravesend|NY|US|40.6|-73.97
Rochester|MN|US|44.02|-92.47
Gondal|Gujarat|IN|21.96|70.8
Chichawatni|Punjab|PK|30.53|72.69
Faridpur|Dhaka Division|BD|23.61|89.84
Apopa|San Salvador Department|SV|13.81|-89.18
Carmona|Calabarzon|PH|14.31|121.06
Laoag|Ilocos|PH|18.2|120.6
Elgin|IL|US|42.04|-88.28
Dharashiv|Maharashtra|IN|18.18|76.04
Xigang|Ningxia|CN|38.55|106.35
Chongfu|Zhejiang|CN|30.53|120.43
Taipa|Our Lady of Carmo|MO|22.16|113.56
Port Blair|Andaman and Nicobar|IN|11.67|92.75
Minatitlan|Veracruz|MX|18|-94.56
Esuk Oron|Akwa Ibom State|NG|4.8|8.25
Atbara|River Nile|SD|17.7|33.99
Vicenza|Veneto|IT|45.55|11.55
Ciudad Guzman|Jalisco|MX|19.7|-103.46
Ballarat|Victoria|AU|-37.57|143.85
Tocoa|Colon Department|HN|15.68|-86
West Jordan|UT|US|40.61|-111.94
Bagalkot|Karnataka|IN|16.19|75.7
Lomas de Zamora|Buenos Aires|AR|-34.76|-58.4
Yeoju|Gyeonggi-do|KR|37.3|127.63
Duma|Rif-dimashq|SY|33.57|36.4
Winterthur|Zurich|CH|47.51|8.72
Novokuybyshevsk|Samara Oblast|RU|53.1|49.94
Bou Saada|M'Sila|DZ|35.21|4.17
Abnub|Asyut|EG|27.27|31.15
Quchan|Razavi Khorasan|IR|37.11|58.51
Manacapuru|Amazonas|BR|-3.3|-60.62
Kuningan|West Java|ID|-6.98|108.48
Suriapet|Telangana|IN|17.14|79.62
Kandy|Central Province|LK|7.29|80.63
Zefta|Gharbia|EG|30.71|31.24
Bangaon|West Bengal|IN|23.05|88.83
Inglewood|CA|US|33.96|-118.35
Kilis|Kilis|TR|36.72|37.12
Terrebonne|Quebec|CA|45.7|-73.65
Kyimyindine|Yangon|MM|16.81|96.12
Set Ka Lay|Yangon|MM|16.81|96.11
Chelmsford|England|GB|51.74|0.47
Marzahn|State of Berlin|DE|52.55|13.57
Chiquimula|Chiquimula|GT|14.8|-89.55
Cileunyi|West Java|ID|-6.94|107.75
Ashoknagar Kalyangarh|West Bengal|IN|22.86|88.64
Mongu|Western Province|ZM|-15.25|23.13
Mulhouse|Grand Est|FR|47.75|7.33
Al Fqih Ben Calah|Beni Mellal-Khenifra|MA|32.5|-6.69
Pulilan|Central Luzon|PH|14.9|120.85
Beau Bassin-Rose Hill|Plaines Wilhems|MU|-20.23|57.47
Tuscaloosa|AL|US|33.21|-87.57
Sogamoso|Boyaca|CO|5.71|-72.93
Sainte-Foy|Quebec|CA|46.78|-71.29
Sainte-Foy-Sillery-Cap-Rouge|Quebec|CA|46.76|-71.35
Mbale|Eastern Region|UG|1.08|34.18
Montreuil|Ile-de-France|FR|48.86|2.44
Terni|Umbria|IT|42.56|12.64
Deesa|Gujarat|IN|24.26|72.18
Navadwip|West Bengal|IN|23.41|88.37
Maran|Pahang|MY|3.59|102.77
Nandurbar|Maharashtra|IN|21.37|74.24
Kasuga|Fukuoka|JP|33.53|130.46
Nsukka|Enugu State|NG|6.86|7.4
Nguru|Yobe State|NG|12.88|10.46
Mabopane|Gauteng|ZA|-25.51|28.06
Namur|Wallonia|BE|50.47|4.87
Cambe|Parana|BR|-23.28|-51.28
Encheng|Guangdong|CN|22.19|112.3
Turhal|Tokat Province|TR|40.39|36.08
Go Vap|Ho Chi Minh City (HCMC)|VN|10.82|106.68
Richardson|TX|US|32.95|-96.73
Bokhtar|Khatlon Province|TJ|37.84|68.78
Hadejia|Jigawa State|NG|12.45|10.04
Zhuji|Zhejiang|CN|29.72|120.24
Perpignan|Occitanie|FR|42.7|2.9
Lowell|MA|US|42.63|-71.32
Lavras|Minas Gerais|BR|-21.25|-45
Sao Pedro da Aldeia|Rio de Janeiro|BR|-22.84|-42.1
East Independence|MO|US|39.1|-94.36
Caen|Normandy|FR|49.19|-0.36
Acailandia|Maranhao|BR|-4.95|-47.5
Kyivskyi|Poltava|UA|49.61|34.53
Borazjan|Bushehr|IR|29.27|51.22
Yenangyaung|Magway|MM|20.47|94.87
Gresham|OR|US|45.5|-122.43
Antioch|CA|US|38|-121.81
Paulinia|Sao Paulo|BR|-22.76|-47.15
Manzini|Manzini Region|SZ|-26.5|31.38
St. John's|Newfoundland and Labrador|CA|47.56|-52.71
Delicias|Aragon|ES|41.65|-0.91
Masindi|Western Region|UG|1.67|31.71
Kfar Saba|Central District|IL|32.17|34.91
Matsuto|Ishikawa|JP|36.52|136.57
Cambridge|MA|US|42.38|-71.11
Sultanpur|Uttar Pradesh|IN|26.26|82.07
Delhi Cantonment|Delhi|IN|28.6|77.13
Firozpur|Punjab|IN|30.93|74.61
Bayugan|Caraga|PH|8.76|125.77
High Point|NC|US|35.96|-80.01
Datun|Jiangsu|CN|34.81|116.9
Manchester|NH|US|43|-71.45
Baneh|Kurdistan Province|IR|36|45.89
Gulshan|Dhaka Division|BD|23.79|90.41
Geylang||SG|1.32|103.89
Kresek|West Java|ID|-6.13|106.38
Bender|Bender Municipality|MD|46.83|29.48
Mbombela|Mpumalanga|ZA|-25.48|30.97
Rodenkirchen|North Rhine-Westphalia|DE|50.89|6.99
Sembawang Estate||SG|1.45|103.83
Gabes|Gabes Governorate|TN|33.88|10.1
Orkney|North West|ZA|-26.98|26.67
Qingnian|Shandong|CN|36.84|115.71
Temecula|CA|US|33.49|-117.15
Lucapa|Luanda Norte|AO|-8.42|20.74
Mendip|England|GB|51.24|-2.63
Qal'at Sukkar|Dhi Qar|IQ|31.86|46.07
An Nu'maniyah|Wasit|IQ|32.56|45.41
Kufa|Najaf|IQ|32.05|44.44
Ressano Garcia|Maputo Province|MZ|-25.44|32
Noyabrsk|Yamalo-Nenets|RU|63.19|75.44
Sengerema|Mwanza|TZ|-2.67|32.65
Bataysk|Rostov|RU|47.14|39.76
Pisa|Tuscany|IT|43.71|10.4
Linshui|Hebei|CN|36.42|114.2
Kamagaya|Chiba|JP|35.77|140
Sutton Coldfield|England|GB|52.57|-1.82
Hailun|Heilongjiang|CN|47.45|126.92
Maramag|Northern Mindanao|PH|7.76|125.01
Kecskemet|Bacs-Kiskun|HU|46.91|19.69
Seversk|Tomsk Oblast|RU|56.6|84.89
Ciamis|West Java|ID|-7.33|108.35
Murrieta|CA|US|33.55|-117.21
Brovary|Kyiv Oblast|UA|50.51|30.79
Santo Antonio de Jesus|Bahia|BR|-12.97|-39.26
Lak Si|Bangkok|TH|13.89|100.58
Wakefield|England|GB|53.68|-1.5
Centennial|CO|US|39.58|-104.88
Shilong|Guangdong|CN|23.11|113.85
Richmond|CA|US|37.94|-122.35
Corona|NY|US|40.75|-73.86
Thoi Lai|Can Tho City|VN|10.07|105.56
Vilhena|Rondonia|BR|-12.74|-60.15
Pandit Deen Dayal Upadhyaya Nagar|Uttar Pradesh|IN|25.28|83.12
Dchira El Jihadia|Souss-Massa|MA|30.37|-9.55
Didao|Heilongjiang|CN|45.35|130.84
Arsuz|Hatay|TR|36.41|35.89
Pelabuhanratu|West Java|ID|-6.99|106.55
Marugame|Kagawa|JP|34.28|133.78
Habikino|Osaka|JP|34.55|135.59
Arzamas|Nizhny Novgorod Oblast|RU|55.4|43.84
Phalaborwa|Limpopo|ZA|-23.94|31.14
Walthamstow|England|GB|51.59|-0.02
Pueblo|CO|US|38.25|-104.61
Guaianases|Sao Paulo|BR|-23.54|-46.41
Ijebu-Igbo|Ogun State|NG|6.97|4
Sergiyev Posad|Moscow Oblast|RU|56.31|38.14
Talisay|Western Visayas|PH|10.74|122.97
San Juan|San Juan|AR|-31.54|-68.53
Sehore|Madhya Pradesh|IN|23.2|77.08
Jianchang|Jiangxi|CN|27.56|116.64
Hulan|Heilongjiang|CN|45.89|126.58
Matagalpa|Matagalpa Department|NI|12.93|-85.92
Khlong Toei|Bangkok|TH|13.71|100.58
Leninsk-Kuznetsky|Kuzbass|RU|54.66|86.17
Kiryu|Gunma|JP|36.4|139.33
Handeni|Tanga|TZ|-5.43|38.02
Balombo|Benguela|AO|-12.35|14.77
Thunder Bay|Ontario|CA|48.38|-89.25
Iwatsuki|Saitama|JP|35.96|139.7
Pearland|TX|US|29.56|-95.29
Dehui|Jilin|CN|44.54|125.69
Pangkalanbuun|Central Kalimantan|ID|-2.68|111.63
Waterbury|CT|US|41.56|-73.05
Greeley|CO|US|40.42|-104.71
Boulogne-Billancourt|Ile-de-France|FR|48.84|2.24
Warisan|Dubai|AE|25.17|55.41
Kalisz|Greater Poland|PL|51.76|18.09
Baia Mare|Maramures|RO|47.66|23.57
Coronel Fabriciano|Minas Gerais|BR|-19.52|-42.63
Mascara|Mascara|DZ|35.4|0.14
Maranguape|Ceara|BR|-3.89|-38.69
Uromi|Edo State|NG|6.7|6.33
Katumba|Mbeya|TZ|-9.23|33.62
Mong Cai|Quang Ninh|VN|21.52|107.97
Vila Maria|Sao Paulo|BR|-23.51|-46.59
Kanpur Cantonment|Uttar Pradesh|IN|26.46|80.38
Komatsu|Ishikawa|JP|36.4|136.45
West Covina|CA|US|34.07|-117.94
Enterprise|NV|US|36.03|-115.24
Bansbaria|West Bengal|IN|22.95|88.4
Giron|Santander Department|CO|7.07|-73.17
Baghlan|Baghlan|AF|36.13|68.71
Muriae|Minas Gerais|BR|-21.13|-42.37
Hanjia|Chongqing|CN|29.3|108.16
Trincomalee|Eastern Province|LK|8.58|81.23
La Cite-Limoilou|Quebec|CA|46.83|-71.23
Santiago|Cagayan Valley|PH|16.69|121.55
Taibai|Chongqing|CN|30.82|108.36
Vedado|Havana|CU|23.14|-82.39
Dagenham|England|GB|51.55|0.17
Xuyong|Sichuan|CN|28.17|105.43
North Charleston|SC|US|32.85|-79.97
Sohar|Al Batinah North|OM|24.35|56.71
Nehe|Heilongjiang|CN|48.48|124.87
Abu Gharaq|Babil|IQ|32.53|44.34
Oktyabrsky|Bashkortostan Republic|RU|54.48|53.47
Tadpatri|Andhra Pradesh|IN|14.91|78.01
Birnin Kebbi|Kebbi|NG|12.45|4.2
Santa Cruz|Calabarzon|PH|14.28|121.42
Novobavarskyi|Kharkiv|UA|49.95|36.16
Everett|WA|US|47.98|-122.2
An Nuhud|West Kordofan|SD|12.7|28.43
Ullyul|South Hwanghae|KP|38.51|125.19
Rijeka|Primorje-Gorski Kotar|HR|45.33|14.44
Douliu|Taiwan|TW|23.71|120.54
Luis Eduardo Magalhaes|Bahia|BR|-12.09|-45.79
Catbalogan|Eastern Visayas|PH|11.78|124.89
College Station|TX|US|30.63|-96.33
As Salt|Balqa|JO|32.04|35.73
Mishima|Shizuoka|JP|35.12|138.92
Baia Farta|Benguela|AO|-12.6|13.2
Jalpaiguri|West Bengal|IN|26.52|88.73
Jalai Nur|Inner Mongolia|CN|49.45|117.7
Tajimi|Gifu|JP|35.32|137.13
Castelar|Buenos Aires|AR|-34.65|-58.64
Pompano Beach|FL|US|26.24|-80.12
Coronel|Biobio|CL|-37.03|-73.14
Bacabal|Maranhao|BR|-4.23|-44.78
Novo Gama|Goias|BR|-16.06|-48.04
Dusit|Bangkok|TH|13.78|100.52
Mandurah|Western Australia|AU|-32.53|115.72
Basingstoke|England|GB|51.26|-1.09
Bandirma|Balikesir|TR|40.35|27.98
Maidstone|England|GB|51.27|0.52
Tieli|Heilongjiang|CN|46.98|128.05
Umm Qasr|Basra|IQ|30.04|47.92
Butterworth|Penang|MY|5.4|100.36
Shaping|Guangdong|CN|22.77|112.96
Labe|Labe Region|GN|11.32|-12.28
Chalus|Mazandaran|IR|36.66|51.42
Koszalin|West Pomerania|PL|54.19|16.17
Bolzano|Trentino-Alto Adige|IT|46.49|11.34
South Fulton|GA|US|33.59|-84.67
Uba|Minas Gerais|BR|-21.12|-42.94
Sherpur|Mymensingh Division|BD|25.02|90.02
Obninsk|Kaluga Oblast|RU|55.11|36.61
Circoiscrizione VI|Piedmont|IT|45.1|7.7
Girardot City|Cundinamarca|CO|4.3|-74.81
Koblenz|Rheinland-Pfalz|DE|50.35|7.58
Itaperuna|Rio de Janeiro|BR|-21.2|-41.89
Siegen|North Rhine-Westphalia|DE|50.87|8.02
Hirnytskyi|Donetsk|UA|48.02|37.97
Mangalagiri|Andhra Pradesh|IN|16.43|80.57
Thohoyandou|Limpopo|ZA|-22.95|30.48
As Suwayq|Al Batinah North|OM|23.85|57.44
Norwalk|CA|US|33.9|-118.08
Yen Vinh|Nghe An Province|VN|18.67|105.67
Mitrovice|Mitrovica|XK|42.88|20.87
Yevpatoriya|Crimea|UA|45.2|33.37
Pati|Central Java|ID|-6.76|111.04
Elista|Kalmykiya Republic|RU|46.31|44.26
Dera Murad Jamali|Balochistan|PK|28.55|68.22
Taungoo|Bago Region|MM|18.94|96.43
Bedford|England|GB|52.13|-0.47
Bagong Silangan|National Capital Region|PH|14.71|121.11
Kangnyong|South Hwanghae|KP|37.91|125.51
Catia La Mar|Vargas|VE|10.61|-67.03
Boulder|CO|US|40.01|-105.27
Anning|Yunnan|CN|24.92|102.48
Ituiutaba|Minas Gerais|BR|-18.97|-49.46
Rayong|Rayong|TH|12.68|101.26
Sirte|Surt|LY|31.21|16.59
Kotri|Sindh|PK|25.37|68.31
Cheremushki|Moscow|RU|55.66|37.56
Broken Arrow|OK|US|36.05|-95.79
Daly City|CA|US|37.71|-122.46
Cikarang|West Java|ID|-6.26|107.15
Arlit|Agadez|NE|18.74|7.39
Baharestan|Isfahan|IR|32.49|51.77
Ba GJon|Quang Tri|VN|17.75|106.42
Ranebennur|Karnataka|IN|14.62|75.63
Longjiang|Heilongjiang|CN|47.34|123.2
Hwado|Gyeonggi-do|KR|37.65|127.31
Buhe|Hubei|CN|30.29|112.23
Hammamet|Nabeul Governorate|TN|36.4|10.62
Pindiga|Gombe State|NG|9.98|10.95
Berdyansk|Zaporizhzhia|UA|46.76|36.79
Toufen|Taiwan|TW|24.69|120.91
Mianeh|East Azerbaijan|IR|37.42|47.72
Dakhla||EH|23.68|-15.96
Paniqui|Central Luzon|PH|15.67|120.58
Novotroitsk|Orenburg Oblast|RU|51.2|58.31
Bergisch Gladbach|North Rhine-Westphalia|DE|50.99|7.13
Rangamati|Chittagong|BD|22.64|92.19
Alchevsk|Luhansk|UA|48.47|38.8
Son La|Son La Province|VN|21.33|103.92
Mingachevir|Mingacevir City|AZ|40.76|47.06
Legnica|Lower Silesia|PL|51.21|16.16
Drammen|Buskerud|NO|59.74|10.2
Pare|East Java|ID|-7.77|112.2
Tokoza|Gauteng|ZA|-26.36|28.13
Balsas|Maranhao|BR|-7.53|-46.04
Sydney|Nova Scotia|CA|46.14|-60.18
Derbent|Dagestan|RU|42.07|48.29
Xinghua|Jiangsu|CN|32.94|119.83
Khurja|Uttar Pradesh|IN|28.25|77.86
Mati|Davao Region|PH|6.96|126.22
Arjawinangun|West Java|ID|-6.65|108.41
Le Plateau-Mont-Royal|Quebec|CA|45.53|-73.58
Funchal|Madeira|PT|32.67|-16.93
Kishanganj|Bihar|IN|26.1|87.96
Yautepec|Morelos|MX|18.88|-99.07
Jatai|Goias|BR|-17.88|-51.72
Sergeli|Tashkent|UZ|41.2|69.22
Azare|Bauchi|NG|11.67|10.19
Nantou|Taiwan|TW|23.92|120.66
Ipojuca|Pernambuco|BR|-8.4|-35.06
Lahad Datu|Sabah|MY|5.02|118.33
Vila Prudente|Sao Paulo|BR|-23.59|-46.57
Subulussalam|Aceh|ID|2.66|97.88
Paragominas|Para|BR|-3|-47.35
Bukama|Haut-Lomami|CD|-9.2|25.85
Ponnani|Kerala|IN|10.77|75.93
Tanza|National Capital Region|PH|14.68|120.94
Inzai|Chiba|JP|35.83|140.16
Bhairab Bazar|Dhaka Division|BD|24.05|90.98
Hindaun|Rajasthan|IN|26.73|77.04
Jamalpur|Bihar|IN|25.31|86.49
Abu Tij|Asyut|EG|27.05|31.32
Coatepeque|Quetzaltenango|GT|14.7|-91.86
Baraki|Algiers|DZ|36.67|3.1
Robat Karim|Tehran|IR|35.48|51.08
'Akra|Nineveh|IQ|36.73|43.88
Sandy Springs|GA|US|33.92|-84.38
Burbank|CA|US|34.18|-118.31
Taling Chan|Bangkok|TH|13.78|100.46
San Justo|Buenos Aires|AR|-34.68|-58.56
Hoa Binh|Phu Tho|VN|20.82|105.34
Saint-Paul|Reunion|RE|-21.01|55.27
Ourense|Galicia|ES|42.34|-7.86
Nagaur|Rajasthan|IN|27.2|73.73
Riacho Fundo II|Federal District|BR|-15.9|-48.05
Green Bay|WI|US|44.52|-88.02
Mityana|Central Region|UG|0.42|32.02
Jizan|Jazan Region|SA|16.89|42.55
Texcoco de Mora|Mexico|MX|19.51|-98.88
Bang Bon|Bangkok|TH|13.66|100.4
Nikopol|Dnipropetrovsk|UA|47.57|34.39
Slovyansk|Donetsk|UA|48.85|37.6
Santa Maria|CA|US|34.95|-120.44
San Francisco De Borja|Lima region|PE|-12.09|-77
Yidu|Shandong|CN|36.77|118.42
Nancy|Grand Est|FR|48.68|6.18
Kuala Krai|Kelantan|MY|5.53|102.2
Zhonghe|Chongqing|CN|28.45|108.99
Universal City|CA|US|34.14|-118.35
Puyang Chengguanzhen|Henan|CN|35.71|115.03
Ikeda|Osaka|JP|34.82|135.43
Waterloo|Ontario|CA|43.47|-80.52
Ambala Sadar|Haryana|IN|30.34|76.86
Chinautla|Guatemala|GT|14.7|-90.5
Salzgitter|Lower Saxony|DE|52.16|10.42
Ville-Marie|Quebec|CA|45.5|-73.57
Moratalaz|Madrid|ES|40.41|-3.65
Bhiwadi|Rajasthan|IN|28.21|76.86
Bundi|Rajasthan|IN|25.44|75.64
Miryalaguda|Telangana|IN|16.87|79.56
Daxing|Beijing|CN|39.74|116.33
Artur Alvim|Sao Paulo|BR|-23.54|-46.49
Assis|Sao Paulo|BR|-22.66|-50.41
Santa Cruz do Capibaribe|Pernambuco|BR|-7.96|-36.2
Yezhou|Hubei|CN|30.6|109.72
Hidalgo del Parral|Chihuahua|MX|26.93|-105.67
Saijo|Ehime|JP|33.92|133.18
Jena|Thuringia|DE|50.93|11.59
Wichita Falls|TX|US|33.91|-98.49
Brantford|Ontario|CA|43.13|-80.27
Gera|Thuringia|DE|50.88|12.08
Tuyen Quang|Tuyen Quang|VN|21.82|105.21
Ottakring|Vienna|AT|48.22|16.3
Al Faw|Basra|IQ|29.97|48.47
Angoche|Nampula|MZ|-16.23|39.91
Depok|Yogyakarta|ID|-7.76|110.43
Toride|Ibaraki|JP|35.9|140.08
Mostar|Federation of B&H|BA|43.34|17.81
Mazyr|Homyel' Voblasc'|BY|52.04|29.22
Kamloops|British Columbia|CA|50.67|-120.32
Mazabuka|Southern Province|ZM|-15.86|27.75
Lakeland|FL|US|28.04|-81.95
Pozniaky|Kyiv City|UA|50.4|30.62
Zhezqazghan|Ulytau Region|KZ|47.79|67.71
Pailou|Chongqing|CN|30.8|108.39
Lo Prado|Santiago Metropolitan|CL|-33.44|-70.73
Tizi Ouzou|Tizi Ouzou|DZ|36.71|4.05
Pulandian|Liaoning|CN|39.4|121.97
Helsingborg|Skane|SE|56.05|12.69
Abreu e Lima|Pernambuco|BR|-7.91|-34.9
Kot Addu|Punjab|PK|30.47|70.97
Bouafle|Sassandra-Marahoue|CI|6.99|-5.74
Kara|Kara|TG|9.55|1.19
Clovis|CA|US|36.83|-119.7
Kafue|Lusaka Province|ZM|-15.77|28.18
Campo Mourao|Parana|BR|-24.04|-52.38
Salaqi|Inner Mongolia|CN|40.54|110.51
Kalulushi|Copperbelt|ZM|-12.84|28.09
Lewisville|TX|US|33.05|-96.99
Oued Zem|Beni Mellal-Khenifra|MA|32.86|-6.57
Weldiya|Amhara|ET|11.83|39.59
Soyibug|Jammu and Kashmir|IN|34.08|74.71
Izmaylovo|Moscow|RU|55.8|37.78
Kiselevsk|Kuzbass|RU|53.99|86.66
Jishu|Jilin|CN|44.32|126.8
El Kelaa des Srarhna|Marrakesh-Safi|MA|32.05|-7.41
Seguela|Woroba|CI|7.96|-6.67
Ourinhos|Sao Paulo|BR|-22.98|-49.87
Totonicapan|Totonicapan|GT|14.91|-91.36
Ad-Damir|River Nile|SD|17.6|33.97
Jagtial|Telangana|IN|18.79|78.92
Woking|England|GB|51.32|-0.56
Roorkee|Uttarakhand|IN|29.87|77.89
Edea|Littoral|CM|3.8|10.13
Yuxi|Yunnan|CN|24.36|102.54
Lincoln|England|GB|53.23|-0.54
Poa|Sao Paulo|BR|-23.53|-46.34
Bashan|Jiangxi|CN|27.77|116.05
Nkpor|Anambra|NG|6.15|6.83
Berberati|Mambere-Kadei|CF|4.26|15.79
Sangla Hill|Punjab|PK|31.72|73.38
Tongren|Qinghai|CN|35.51|102.02
Tyler|TX|US|32.35|-95.3
Male|Kaafu Atoll|MV|4.18|73.51
El Cajon|CA|US|32.79|-116.96
Mandaqui|Sao Paulo|BR|-23.46|-46.64
Piacenza|Emilia-Romagna|IT|45.05|9.69
Gardez|Paktia|AF|33.6|69.23
Zhanaozen|Mangystau|KZ|43.34|52.86
Gangu Chengguanzhen|Gansu|CN|34.74|105.33
Teziutlan|Puebla|MX|19.82|-97.36
Kolda|Kolda|SN|12.89|-14.94
Vila Matilde|Sao Paulo|BR|-23.54|-46.52
Udgir|Maharashtra|IN|18.39|77.12
San Mateo|CA|US|37.56|-122.33
Viseu|Viseu|PT|40.66|-7.91
Nagda|Madhya Pradesh|IN|23.46|75.42
Moers|North Rhine-Westphalia|DE|51.45|6.63
Brandon|FL|US|27.94|-82.29
Buzau|Buzau County|RO|45.15|26.83
Reus|Catalonia|ES|41.16|1.11
Prabumulih|South Sumatra|ID|-3.43|104.23
Itabaiana|Sergipe|BR|-10.69|-37.43
Francistown|City of Francistown|BW|-21.17|27.51
Isehara|Kanagawa|JP|35.4|139.31
Queluz|Lisbon|PT|38.76|-9.25
Betul|Madhya Pradesh|IN|21.9|77.9
Chikushino-shi|Fukuoka|JP|33.5|130.52
Akademicheskoe|Leningradskaya Oblast'|RU|60.01|30.39
Turgutlu|Manisa|TR|38.5|27.7
Lida|Grodnenskaya|BY|53.88|25.3
Taitung|Taiwan|TW|22.76|121.14
Kalynivskyi|Donetsk|UA|48.01|37.85
San|Segou|ML|13.3|-4.9
Jahanabad|Bihar|IN|25.21|84.99
Lethbridge|Alberta|CA|49.7|-112.82
Cursino|Sao Paulo|BR|-23.63|-46.62
Velikiye Luki|Pskov Oblast|RU|56.34|30.54
Kashipur|Uttarakhand|IN|29.21|78.96
Rialto|CA|US|34.11|-117.37
West Bromwich|England|GB|52.52|-1.99
Ghazipur|Uttar Pradesh|IN|25.58|83.59
Tanjung Pandan|Bangka-Belitung Islands|ID|-2.73|107.63
Ikere-Ekiti|Ekiti State|NG|7.5|5.23
Hildesheim|Lower Saxony|DE|52.15|9.95
Kharian|Punjab|PK|32.82|73.89
Bendigo|Victoria|AU|-36.76|144.28
Rantauprapat|North Sumatra|ID|2.1|99.83
Chumakivskyi|Donetsk|UA|47.96|37.94
Nkayi|Bouenza|CG|-4.18|13.29
Amaravati|Andhra Pradesh|IN|16.51|80.52
Bogorodskoye|Moscow|RU|55.81|37.72
Parsabad|Ardabil Province|IR|39.65|47.92
Lahan|Madhesh|NP|26.72|86.48
Liberec|Liberec Region|CZ|50.77|15.06
Nagapattinam|Tamil Nadu|IN|10.76|79.84
Qurayyat|Al Jawf Region|SA|31.33|37.34
Buxar|Bihar|IN|25.58|83.98
Portmore|Saint Catherine Parish|JM|17.97|-76.89
Santa Rosa|La Pampa|AR|-36.62|-64.29
Palma Soriano|Santiago de Cuba Province|CU|20.21|-75.99
Pushkino|Moscow Oblast|RU|55.99|37.83
Khushab|Punjab|PK|32.3|72.35
Lafiagi|Kwara State|NG|8.85|5.42
Caieiras|Sao Paulo|BR|-23.36|-46.74
Xincheng|Xinjiang|CN|41.71|82.93
Lyon 03|Auvergne-Rhone-Alpes|FR|45.76|4.85
Pasrur|Punjab|PK|32.26|74.66
Belawan|North Sumatra|ID|3.78|98.68
Pano Aqil|Sindh|PK|27.86|69.11
Piatra Neamt|Neamt County|RO|46.92|26.33
Cabudare|Lara|VE|10.03|-69.26
Erlangen|Bavaria|DE|49.59|11.01
Tepexpan|Mexico|MX|19.61|-98.94
Tivaouane|Thies|SN|14.95|-16.82
Entebbe|Central Region|UG|0.06|32.48
Davenport|IA|US|41.52|-90.58
Darnah|Darnah|LY|32.77|22.64
Dayrut|Asyut|EG|27.56|30.81
Whalley|British Columbia|CA|49.18|-122.87
Edison|NJ|US|40.52|-74.41
Skhidni Kvartaly|Luhansk|UA|48.57|39.38
Curico|Maule Region|CL|-34.98|-71.24
Kangson|South Pyongan|KP|38.94|125.58
La Vega|La Vega|DO|19.22|-70.53
Shahzadpur|Rajshahi Division|BD|24.18|89.6
Tulancingo|Hidalgo|MX|20.08|-98.37
Perdizes|Sao Paulo|BR|-23.54|-46.68
Yono|Saitama|JP|35.88|139.63
Apatzingan|Michoacan|MX|19.09|-102.36
Ciutat Vella|Catalonia|ES|41.38|2.17
Hillsboro|OR|US|45.52|-122.99
Mormugao|Goa|IN|15.39|73.81
Seoni|Madhya Pradesh|IN|22.09|79.55
Shabqadar|Khyber Pakhtunkhwa|PK|34.22|71.55
Mitte|State of Berlin|DE|52.52|13.4
Sabanalarga|Atlantico|CO|10.63|-74.92
Jishou|Hunan|CN|28.32|109.73
Ngong|Kajiado County|KE|-1.35|36.67
Francisco Beltrao|Parana|BR|-26.08|-53.05
Sebeta|Oromiya|ET|8.92|38.62
Artem|Primorye|RU|43.36|132.19
Tsuyama|Okayama|JP|35.05|134
Limerick|Munster|IE|52.66|-8.62
Aurangabad|Bihar|IN|24.75|84.37
Lampa|Santiago Metropolitan|CL|-33.29|-70.88
Sungai Penuh|Jambi|ID|-2.06|101.39
Ukhta|Komi|RU|63.57|53.69
Japeri|Rio de Janeiro|BR|-22.64|-43.65
Nakhon Si Thammarat|Nakhon Si Thammarat|TH|8.43|99.97
Putatan|National Capital Region|PH|14.4|121.05
Shuifu|Yunnan|CN|28.63|104.41
Kani|Gifu|JP|35.4|137.06
Onojo|Fukuoka|JP|33.54|130.48
Kot Radha Kishan|Punjab|PK|31.17|74.1
Al Jumayl|An Nuqat al Khams|LY|32.85|12.06
Shchukino|Moscow|RU|55.8|37.45
Brateyevo|Moscow|RU|55.64|37.76
Maldonado|Maldonado|UY|-34.9|-54.95
Venlo|Limburg|NL|51.37|6.17
Mairipora|Sao Paulo|BR|-23.32|-46.59
Novara|Piedmont|IT|45.45|8.62
Shushtar|Khuzestan|IR|32.05|48.85
Wilmersdorf|State of Berlin|DE|52.48|13.32
Al-Musayab|Babil|IQ|32.78|44.29
Por do Sol|Federal District|BR|-15.86|-48.12
Parintins|Amazonas|BR|-2.63|-56.74
Hedong|Guangdong|CN|23.92|115.78
Hinganghat|Maharashtra|IN|20.55|78.84
Zonguldak|Zonguldak Province|TR|41.45|31.79
Igdir|Igdir|TR|39.92|44.05
Kawachi-Nagano|Osaka|JP|34.44|135.58
Eastbourne|England|GB|50.77|0.28
Dhamtari|Chhattisgarh|IN|20.71|81.55
Delta|British Columbia|CA|49.09|-123.05
Orsha|Vitebsk|BY|54.51|30.4
Worcester|England|GB|52.19|-2.22
Las Cruces|NM|US|32.31|-106.78
Szekesfehervar|Fejer|HU|47.19|18.41
Lagarto|Sergipe|BR|-10.92|-37.65
Kindrativskyi|Donetsk|UA|48.3|38.05
Bath|England|GB|51.38|-2.36
Sidi Slimane|Rabat-Sale-Kenitra|MA|34.26|-5.93
Leme|Sao Paulo|BR|-22.19|-47.39
Iida|Nagano|JP|35.52|137.82
Los Puertos de Altagracia|Zulia|VE|10.71|-71.52
South Bend|IN|US|41.68|-86.25
Kansk|Krasnoyarsk Krai|RU|56.2|95.72
Kalmiuskyi|Donetsk|UA|47.11|37.54
Chilliwack|British Columbia|CA|49.17|-121.95
Queenstown Estate||SG|1.29|103.8
Argenteuil|Ile-de-France|FR|48.95|2.25
Khanty-Mansiysk|Khanty-Mansia|RU|61|69.03
Isulan|Soccsksargen|PH|6.63|124.61
Itaim Bibi|Sao Paulo|BR|-23.59|-46.68
Mbake|Diourbel Region|SN|14.79|-15.91
Pavlohrad|Dnipropetrovsk|UA|48.53|35.87
Simmering|Vienna|AT|48.18|16.43
Mustafakemalpasa|Bursa Province|TR|40.04|28.41
Burayu|Oromiya|ET|9.04|38.66
Chilakalurupet|Andhra Pradesh|IN|16.09|80.17
Malappuram|Kerala|IN|11.04|76.08
Ebolowa|South|CM|2.9|11.15
Dartmouth|Nova Scotia|CA|44.67|-63.58
Orihuela|Valencia|ES|38.08|-0.94
Kallang||SG|1.33|103.87
Sangju|Gyeongsangbuk-do|KR|36.42|128.16
Perling|Johor|MY|1.48|103.68
Albany|NY|US|42.65|-73.76
Sao Cristovao|Sergipe|BR|-11.01|-37.21
Medina Estates|Greater Accra|GH|5.67|-0.16
Chakwal|Punjab|PK|32.93|72.85
Nga Bay|Can Tho City|VN|9.81|105.82
Gillingham|England|GB|51.39|0.55
Suruc|Sanliurfa|TR|36.98|38.43
Huacheng|Guangdong|CN|24.07|115.61
Ocana|Norte de Santander Department|CO|8.24|-73.36
Hong Ngu|Dong Thap|VN|10.8|105.35
Daoukro|Lacs District|CI|7.06|-3.96
Tokuyama|Yamaguchi|JP|34.05|131.82
Tima|Sohag|EG|26.91|31.43
Donghae City|Gangwon-do|KR|37.54|129.11
Standerton|Mpumalanga|ZA|-26.93|29.24
Kanoya|Kagoshima|JP|31.38|130.85
Mokopane|Limpopo|ZA|-24.19|29.01
Dikirnis|Dakahlia|EG|31.09|31.59
New Bedford|MA|US|41.64|-70.93
Lahijan|Gilan Province|IR|37.2|50.01
Leuven|Flanders|BE|50.88|4.7
Mezhdurechensk|Kuzbass|RU|53.69|88.06
Banswara|Rajasthan|IN|23.54|74.44
Jolo|Autonomous Region in Muslim Mindanao|PH|6.05|121
Ryazanskiy|Moscow|RU|55.73|37.77
Novyye Cheremushki|Moscow|RU|55.7|37.58
Elbasan|Elbasan County|AL|41.11|20.08
Pechersk|Kyiv City|UA|50.44|30.52
Ijok|Selangor|MY|3.32|101.4
Vista|CA|US|33.2|-117.24
Davie|FL|US|26.06|-80.23
Errachidia|Draa-Tafilalet|MA|31.93|-4.43
Twifu Praso|Central|GH|5.61|-1.55
Red Deer|Alberta|CA|52.27|-113.8
Solikamsk|Perm Krai|RU|59.67|56.74
El Progreso|Yoro Department|HN|15.4|-87.8
Chirmiri|Chhattisgarh|IN|23.19|82.35
Barra do Pirai|Rio de Janeiro|BR|-22.47|-43.83
Chikusei|Ibaraki|JP|36.32|139.98
Sungailiat|Bangka-Belitung Islands|ID|-1.85|106.12
Arezzo|Tuscany|IT|43.46|11.88
Ujpest|Budapest|HU|47.57|19.08
Calasiao|Ilocos|PH|16.01|120.36
Glazov|Udmurtiya Republic|RU|58.14|52.66
Rosarito|Baja California|MX|32.36|-117.05
Kallithea|Attica|GR|37.95|23.7
Ahar|East Azerbaijan|IR|38.48|47.07
Juan Diaz|Panama|PA|9.04|-79.44
Yen Bai|Lao Cai|VN|21.72|104.91
Grogol|Central Java|ID|-7.6|110.82
Nahiyat al Iskandariyah|Babil|IQ|32.89|44.35
Puerto Barrios|Izabal Department|GT|15.73|-88.6
Bakwa|Haut-Uele|CD|4.13|27.4
Itarsi|Madhya Pradesh|IN|22.61|77.76
Chinatown|CA|US|37.8|-122.41
Votuporanga|Sao Paulo|BR|-20.42|-49.97
Si Maha Phot|Prachin Buri|TH|13.97|101.51
Ha Tien|An Giang|VN|10.38|104.49
Oleksiyivka|Kharkiv|UA|50.05|36.19
Masjed Soleyman|Khuzestan|IR|31.94|49.3
Los Rastrojos|Lara|VE|10.03|-69.24
Vasco da Gama|Goa|IN|15.4|73.82
Barakaldo|Basque Country|ES|43.3|-2.99
Oleksandrivskyi|Donetsk|UA|47.97|37.8
Ermelo|Mpumalanga|ZA|-26.53|29.98
Klagenfurt am Woerthersee|Carinthia|AT|46.62|14.31
Linxi|Hebei|CN|39.71|118.45
Tiebo|Diourbel Region|SN|14.63|-16.23
Gangtok|Sikkim|IN|27.33|88.61
Datia|Madhya Pradesh|IN|25.67|78.46
Sakado|Saitama|JP|35.96|139.39
Sakata|Yamagata|JP|38.92|139.85
Ust'-Ilimsk|Irkutsk Oblast|RU|58|102.66
Girona|Catalonia|ES|41.98|2.82
Renton|WA|US|47.48|-122.22
Chust|Namangan|UZ|41|71.24
Kalmunai|Eastern Province|LK|7.41|81.83
Udine|Friuli Venezia Giulia|IT|46.07|13.24
Xinzhai|Shandong|CN|36.4|118.62
Phagwara|Punjab|IN|31.22|75.77
Izumisano|Osaka|JP|34.42|135.32
Trier|Rheinland-Pfalz|DE|49.76|6.64
Ginowan|Okinawa|JP|26.26|127.76
Inda Silase|Tigray|ET|14.1|38.28
Negara|Bali|ID|-8.36|114.62
Cacapava|Sao Paulo|BR|-23.1|-45.71
Qasr Bin Ghashir|Tripoli|LY|32.68|13.18
Renala Khurd|Punjab|PK|30.88|73.6
Punta Cana|La Altagracia Province|DO|18.58|-68.4
Roanoke|VA|US|37.27|-79.94
Yanjia|Chongqing|CN|29.83|107
Kangding|Sichuan|CN|30|101.96
Suifenhe|Heilongjiang|CN|44.4|131.15
Sino-Singapore Tianjin Eco-city|Tianjin|CN|39.15|117.78
Alamar|Havana|CU|23.16|-82.28
Becontree|England|GB|51.55|0.13
Sumedang Utara|West Java|ID|-6.85|107.92
Jaffa|Tel Aviv|IL|32.05|34.75
Airoli|Maharashtra|IN|19.15|73
Shahrak-e Pardisan|Qom Province|IR|34.56|50.8
P'yongsong|South Pyongan|KP|39.25|125.87
Tajura'|Tripoli|LY|32.88|13.35
Colonia Lindavista|Mexico|MX|19.49|-99.12
Sentul|Kuala Lumpur|MY|3.18|101.68
Seri Manjung|Perak|MY|4.2|100.67
Bandar Mahkota Cheras|Selangor|MY|3.05|101.8
Alasia|Lagos|NG|6.47|3.17
Raja Jang|Punjab|PK|31.22|74.25
Model Town|Punjab|PK|31.48|74.33
Subotica|Vojvodina|RS|46.1|19.67
Tekstil'shchiki|Moscow|RU|55.7|37.74
Nyagatare|Eastern Province|RW|-1.3|30.32
Sabt Alalayah|'Asir Region|SA|19.58|41.96
Sakiet ez Zit|Sfax Governorate|TN|34.8|10.76
al-Yarmuk|Damascus Governorate|SY|33.47|36.3
Jaramana|Rif-dimashq|SY|33.49|36.35
Qincheng|Jiangxi|CN|27.21|116.53
Luckeesarai|Bihar|IN|25.18|86.09
Menghuan|Yunnan|CN|24.44|98.58
Srodmiescie|Mazovia|PL|52.23|21.02
Hagere Hiywet|Oromiya|ET|8.98|37.85
San Angelo|TX|US|31.46|-100.44
Kambove|Haut-Katanga|CD|-10.87|26.6
Bislig|Caraga|PH|8.22|126.32
Xixiang|Shaanxi|CN|32.99|107.76
Dipalpur|Punjab|PK|30.67|73.65
Kenosha|WI|US|42.58|-87.82
Nabire|Central Papua|ID|-3.36|135.5
Chanthaburi|Chanthaburi|TH|12.61|102.1
Niagara Falls|Ontario|CA|43.1|-79.07
Andria|Apulia|IT|41.23|16.3
Tucupita|Delta Amacuro|VE|9.06|-62.05
Clinton Township|MI|US|42.59|-82.92
Shikohabad|Uttar Pradesh|IN|27.11|78.59
Villa de Cura|Aragua|VE|10.04|-67.49
Al Jammaliyah|Dakahlia|EG|31.18|31.86
San Chaung|Yangon|MM|17.1|96.1
Wangkui|Heilongjiang|CN|46.83|126.48
Columbia|MD|US|39.24|-76.84
Zelenodolsk|Tatarstan Republic|RU|55.84|48.52
Al Qusiyah|Asyut|EG|27.44|30.82
Dschang|West|CM|5.44|10.05
Tucuruvi|Sao Paulo|BR|-23.48|-46.61
Hwasong|North Hamgyong|KP|41.26|129.49
Myonggan-dong|North Hamgyong|KP|41.14|129.49
Dhahran|Eastern Province|SA|26.29|50.11
Santiago de Compostela|Galicia|ES|42.88|-8.55
Roubaix|Hauts-de-France|FR|50.69|3.17
Manbij|Aleppo|SY|36.53|37.95
Olomouc|Olomouc Region|CZ|49.6|17.25
Novoshakhtinsk|Rostov|RU|47.76|39.93
Erie|PA|US|42.13|-80.09
Kasganj|Uttar Pradesh|IN|27.81|78.65
Siauliai|Siauliai|LT|55.93|23.32
Hualien City|Taiwan|TW|23.98|121.6
Meihekou|Jilin|CN|42.53|125.68
Santander de Quilichao|Cauca Department|CO|3.01|-76.48
Xinle|Hebei|CN|38.35|114.69
Acharnes|Attica|GR|38.08|23.73
Qubo Saeed Khan|Sindh|PK|27.87|67.71
Mafinga|Iringa|TZ|-8.3|35.29
Taman Melawati|Selangor|MY|3.21|101.75
Minya al Qamh|Sharqia|EG|30.52|31.35
Bang Rak|Bangkok|TH|13.73|100.52
Burao|Togdheer|SO|9.52|45.53
Bam|Kerman|IR|29.11|58.36
Manavgat|Antalya|TR|36.79|31.44
Guercif|Fes-Meknes|MA|34.23|-3.35
Khambhat|Gujarat|IN|22.32|72.62
Tourcoing|Hauts-de-France|FR|50.72|3.16
Kandhkot|Sindh|PK|28.25|69.18
Saku|Nagano|JP|36.22|138.48
Srodmiescie|Lower Silesia|PL|51.11|17.08
Bhola|Barisal Division|BD|22.69|90.64
Talara|Piura|PE|-4.58|-81.27
Riberalta|Beni Department|BO|-11.01|-66.05
Linghe|Shandong|CN|36.36|119.08
Siverskodonetsk|Luhansk|UA|48.94|38.49
Moron|Buenos Aires|AR|-34.65|-58.62
Zarate|Buenos Aires|AR|-34.1|-59.02
Portsmouth Heights|VA|US|36.82|-76.37
Kohima|Nagaland|IN|25.67|94.11
Richmond Hill|NY|US|40.7|-73.83
Choma|Southern Province|ZM|-16.81|26.99
Xingcheng|Liaoning|CN|40.62|120.72
Paoy Paet|Banteay Meanchey|KH|13.66|102.56
Pandharpur|Maharashtra|IN|17.68|75.33
Kapurthala Town|Punjab|IN|31.38|75.38
Itoshima|Fukuoka|JP|33.54|130.18
Burzaco|Buenos Aires|AR|-34.83|-58.4
Sarapul|Udmurtiya Republic|RU|56.48|53.8
Saint-Laurent|Quebec|CA|45.5|-73.67
Zwickau|Saxony|DE|50.73|12.49
Circoiscrizione IV|Piedmont|IT|45.08|7.63
Kontagora|Niger State|NG|10.4|5.47
Corumba|Mato Grosso do Sul|BR|-19.01|-57.65
Kaiserslautern|Rheinland-Pfalz|DE|49.44|7.77
Alief|TX|US|29.71|-95.6
Soma|Manisa|TR|39.19|27.61
Thimphu|Thimphu District|BT|27.47|89.64
Bocaue|Central Luzon|PH|14.8|120.93
Votkinsk|Udmurtiya Republic|RU|57.05|53.99
Caldas Novas|Goias|BR|-17.74|-48.63
Spring Hill|FL|US|28.48|-82.53
Sao Sebastiao|Federal District|BR|-15.9|-47.78
Slupsk|Pomerania|PL|54.46|17.03
Tatuape|Sao Paulo|BR|-23.54|-46.57
Ponta Pora|Mato Grosso do Sul|BR|-22.54|-55.73
Renqiu|Hebei|CN|38.71|116.1
Mahuva|Gujarat|IN|21.09|71.77
Cardenas|Matanzas Province|CU|23.04|-81.21
Bridgetown|Saint Michael|BB|13.11|-59.62
Compton|CA|US|33.9|-118.22
Serov|Sverdlovsk Oblast|RU|59.6|60.59
Habbouch|Nabatieh|LB|33.41|35.48
Phong GJien|Can Tho City|VN|10|105.67
Xinshi|Hubei|CN|31.05|113.14
Vinh Thanh|Can Tho City|VN|10.22|105.4
Landstrasse|Vienna|AT|48.2|16.39
Budapest IV. keruelet|Budapest|HU|47.56|19.09
League City|TX|US|29.51|-95.09
Flint|MI|US|43.01|-83.69
Silvassa|Dadra and Nagar Haveli and Daman and Diu|IN|20.27|73
Al Qatif|Eastern Province|SA|26.57|50.01
Konan|Aichi|JP|35.33|136.87
Guaiba|Rio Grande do Sul|BR|-30.11|-51.33
Balangir|Odisha|IN|20.7|83.49
Lagos de Moreno|Jalisco|MX|21.36|-101.93
Chengzihe|Heilongjiang|CN|45.34|131
Thayetmyo|Magway|MM|19.32|95.18
Penzing|Vienna|AT|48.2|16.27
Xishan|Hunan|CN|27.67|113.5
Allen|TX|US|33.1|-96.67
Barika|Batna|DZ|35.39|5.37
Ain Oussera|Djelfa|DZ|35.45|2.91
Balashov|Saratov Oblast|RU|51.55|43.17
Arsi Negele|Oromiya|ET|7.35|38.67
Dukuhturi|Central Java|ID|-6.9|109.08
Iguatu|Ceara|BR|-6.36|-39.3
Fasa|Fars|IR|28.94|53.65
Saint-Jean-sur-Richelieu|Quebec|CA|45.31|-73.26
Nawada|Bihar|IN|24.89|85.54
Lugo|Galicia|ES|43.01|-7.56
Bhilai Charoda|Chhattisgarh|IN|21.22|81.46
Minab|Hormozgan|IR|27.13|57.09
Dar'a|Daraa|SY|32.62|36.1
Shamli|Uttar Pradesh|IN|29.45|77.31
Chitose|Hokkaido|JP|42.82|141.65
Yeyuan|Shandong|CN|36.42|118.5
Trelew|Chubut|AR|-43.25|-65.31
Kamyanets-Podilskyi|Khmelnytskyi|UA|48.68|26.59
Zheleznogorsk|Kursk Oblast|RU|52.34|35.36
Kahta|Adiyaman Province|TR|37.79|38.62
Valenca|Bahia|BR|-13.37|-39.07
Santa Cruz de Yojoa|Cortes Department|HN|14.98|-87.89
Dorchester|MA|US|42.3|-71.07
Erdenet|Orhon|MN|49.03|104.08
Hyesan-dong|Yanggang-do|KP|41.4|128.19
Temixco|Morelos|MX|18.85|-99.22
Namalombwe|Lusaka Province|ZM|-15.39|28.19
Asan|Chungcheongnam-do|KR|36.78|127
Catarman|Eastern Visayas|PH|12.5|124.64
Jharsuguda|Odisha|IN|21.86|84.01
Go Cong|Dong Thap|VN|10.37|106.67
Guanhu|Jiangsu|CN|34.43|118
Itauna|Minas Gerais|BR|-20.08|-44.58
Tha Raeng|Bangkok|TH|13.87|100.65
Sadatpur Gujran|Delhi|IN|28.73|77.25
Meidling|Vienna|AT|48.17|16.33
Oulad Teima|Souss-Massa|MA|30.39|-9.21
Jiudian|Shandong|CN|36.99|120.2
Gambela|Gambela|ET|8.25|34.58
Chalisgaon|Maharashtra|IN|20.46|75.02
Rochdale|England|GB|53.62|-2.16
Aguachica|Cesar Department|CO|8.31|-73.62
Jeremie|Grand'Anse|HT|18.65|-74.12
Xinxing|Gansu|CN|34.78|105.32
Herzliya|Tel Aviv|IL|32.17|34.83
Parand|Tehran|IR|35.47|50.98
Rio Largo|Alagoas|BR|-9.48|-35.85
Pyinmana|Nay Pyi Taw|MM|19.74|96.21
Villupuram|Tamil Nadu|IN|11.94|79.49
Amalner|Maharashtra|IN|21.04|75.06
Kuje|FCT|NG|8.88|7.23
Lujan|Buenos Aires|AR|-34.57|-59.11
Swabi|Khyber Pakhtunkhwa|PK|34.12|72.47
Hadera|Haifa|IL|32.44|34.9
Deventer|Overijssel|NL|52.26|6.16
Villa Alemana|Valparaiso|CL|-33.05|-71.37
Brikama|Western|GM|13.27|-16.65
Bayeux|Paraiba|BR|-7.12|-34.93
Tellicherry|Kerala|IN|11.75|75.49
Naxcivan|Nakhchivan|AZ|39.21|45.41
Zhukovsky|Moscow Oblast|RU|55.6|38.12
Kameoka|Kyoto|JP|35|135.58
Mission Viejo|CA|US|33.6|-117.67
Para de Minas|Minas Gerais|BR|-19.86|-44.61
Cesena|Emilia-Romagna|IT|44.14|12.24
Manjeri|Kerala|IN|11.12|76.12
Munakata|Fukuoka|JP|33.8|130.56
Messaad|Djelfa|DZ|34.15|3.5
Escalante|Western Visayas|PH|10.84|123.5
Molenbeek-Saint-Jean|Brussels Capital|BE|50.85|4.31
Fangshan|Beijing|CN|39.69|116
Chimaltenango|Chimaltenango|GT|14.66|-90.82
Magway|Magway|MM|20.15|94.93
Tumbes|Tumbes|PE|-3.56|-80.44
Dijkot|Punjab|PK|31.22|73
Quvasoy|Fergana|UZ|40.3|71.98
Beshariq|Fergana|UZ|40.44|70.61
Bekobod|Tashkent Region|UZ|40.22|69.27
Jinniu|Yunnan|CN|25.8|100.57
Vicente Pires|Federal District|BR|-15.81|-48.03
Caotun|Taiwan|TW|23.98|120.69
Ariquemes|Rondonia|BR|-9.91|-63.04
Vacaville|CA|US|38.36|-121.99
Grand-Bassam|Comoe District|CI|5.21|-3.74
Binga|Mongala|CD|2.37|20.5
Yasuj|Kohgiluyeh and Boyer-Ahmad|IR|30.67|51.59
Villa Mercedes|San Luis|AR|-33.68|-65.46
Ben Guerir|Marrakesh-Safi|MA|32.24|-7.95
Wabu|Gyeonggi-do|KR|37.59|127.22
Ventura|CA|US|34.28|-119.29
Khurarianwala|Punjab|PK|31.5|73.27
Houzhen|Shandong|CN|36.99|118.97
Dogonbadan|Kohgiluyeh and Boyer-Ahmad|IR|30.36|50.8
Sumber|West Java|ID|-6.76|108.48
Highlands Ranch|CO|US|39.55|-104.97
Lawton|OK|US|34.61|-98.39
Azimpur|Dhaka Division|BD|23.73|90.39
Schwerin|Mecklenburg-Vorpommern|DE|53.63|11.41
Beaverton|OR|US|45.49|-122.8
Jaworzno|Silesia|PL|50.21|19.27
Zhudong|Taiwan|TW|24.73|121.09
Gongguan|Guangxi|CN|21.8|109.6
Pouytenga|Centre-Est|BF|12.25|-0.43
Esteli|Esteli Department|NI|13.09|-86.36
Soligorsk|Minsk|BY|52.79|27.54
Nghia GJo|Hanoi|VN|21.05|105.8
Monkayo|Davao Region|PH|7.82|126.05
South Gate|CA|US|33.95|-118.21
Jounieh|Mount Lebanon|LB|33.98|35.62
Caloundra|Queensland|AU|-26.8|153.12
Ceyhan|Adana|TR|37.02|35.82
Birgaon|Chhattisgarh|IN|21.31|81.63
Shibata|Niigata|JP|37.95|139.33
Stellenbosch|Western Cape|ZA|-33.93|18.87
Barmer|Rajasthan|IN|25.75|71.39
Maribor|Urban Municipality of Maribor|SI|46.56|15.65
Portsmouth|VA|US|36.84|-76.3
Muroran|Hokkaido|JP|42.32|140.99
Guetersloh|North Rhine-Westphalia|DE|51.91|8.38
Limpio|Central Department|PY|-25.17|-57.49
Saint-Denis|Ile-de-France|FR|48.94|2.35
Khost|Khowst|AF|33.34|69.92
Sparks|NV|US|39.53|-119.75
Erechim|Rio Grande do Sul|BR|-27.63|-52.28
Caceres|Extremadura|ES|39.48|-6.37
Nanxi|Sichuan|CN|28.84|104.98
General Trias|Calabarzon|PH|14.39|120.88
Puth Kalan|Delhi|IN|28.71|77.08
Japekrom|Bono|GH|7.58|-2.79
Ramenskoye|Moscow Oblast|RU|55.56|38.24
Ouislane|Fes-Meknes|MA|33.91|-5.49
Hemel Hempstead|England|GB|51.75|-0.45
Kuniyamuttur|Tamil Nadu|IN|10.96|76.95
Bang Na|Bangkok|TH|13.67|100.64
Sardarshahr|Rajasthan|IN|28.44|74.49
Sanand|Gujarat|IN|22.99|72.38
Sahibganj|Jharkhand|IN|25.24|87.63
Ash-Shaykh Zayid|Giza|EG|30.02|31
Tema New Town|Greater Accra|GH|5.65|0.03
Lubu|Guangdong|CN|23.17|112.28
Jastrzebie Zdroj|Silesia|PL|49.96|18.57
Rio Gallegos|Santa Cruz|AR|-51.63|-69.25
Shimada|Shizuoka|JP|34.82|138.18
Jinsha|Jiangsu|CN|32.09|121.07
Ciudad Rio Bravo|Tamaulipas|MX|25.99|-98.09
Psie Pole|Lower Silesia|PL|51.15|17.04
Unch'on-up|South Hwanghae|KP|38.57|125.43
Paramagudi|Tamil Nadu|IN|9.55|78.59
Shkoder|Shkoder County|AL|42.07|19.51
Zerakpur|Punjab|IN|30.66|76.82
Las Rozas de Madrid|Madrid|ES|40.49|-3.87
Yuma|AZ|US|32.73|-114.62
Paranavai|Parana|BR|-23.07|-52.47
Ducheng|Guangdong|CN|23.24|111.53
Cipolletti|Rio Negro|AR|-38.93|-67.99
Kamisu|Ibaraki|JP|35.9|140.67
Burdur|Burdur|TR|37.72|30.29
Shenjiamen|Zhejiang|CN|29.96|122.3
Omura|Nagasaki|JP|32.92|129.95
San Carlos de Bariloche|Rio Negro|AR|-41.15|-71.31
Inhambane|Inhambane Province|MZ|-23.86|35.38
La Habana Vieja|Havana|CU|23.13|-82.35
Novopolotsk|Vitebsk|BY|55.53|28.59
Tiruchengode|Tamil Nadu|IN|11.38|77.89
Amozoc de Mota|Puebla|MX|19.05|-98.05
Brockton|MA|US|42.08|-71.02
Owendo|Estuaire|GA|0.29|9.5
Mons|Wallonia|BE|50.45|3.95
Huong Thuy|Thua Thien Hue Province|VN|16.42|107.64
Yotsukaido|Chiba|JP|35.65|140.17
Boli|Heilongjiang|CN|45.75|130.58
Gafsa|Gafsa|TN|34.42|8.78
Xiaoshan|Zhejiang|CN|30.17|120.26
Saint-Michel de l'Atalaye|Artibonite|HT|19.37|-72.33
Xingguo|Gansu|CN|34.86|105.67
Pagoh|Johor|MY|2.15|102.77
San Fernando|Andalusia|ES|36.48|-6.2
Dearborn|MI|US|42.32|-83.18
Federal Way|WA|US|47.32|-122.31
Closepet|Karnataka|IN|12.72|77.28
Emmiganur|Andhra Pradesh|IN|15.77|77.48
Labuan|Labuan|MY|5.28|115.25
Lindi|Lindi|TZ|-10|39.72
Lee's Summit|MO|US|38.91|-94.38
Daanbantayan|Central Visayas|PH|11.25|124.01
Vaniyambadi|Tamil Nadu|IN|12.68|78.62
Delft|South Holland|NL|52.01|4.36
Kovilpatti|Tamil Nadu|IN|9.17|77.87
Asheville|NC|US|35.6|-82.55
Zaxo|Duhok|IQ|37.15|42.69
Ushirombo|Geita|TZ|-3.49|31.96
Aqaba|Aqaba|JO|29.53|35.01
Catumbela|Benguela|AO|-12.43|13.55
Frederiksberg|Capital Region|DK|55.68|12.53
Kutloanong|Free State|ZA|-27.83|26.75
Biu|Borno State|NG|10.61|12.19
Olupona|Osun State|NG|7.6|4.19
Romford|England|GB|51.58|0.19
Ozerki|St.-Petersburg|RU|60.04|30.31
Novogireyevo|Moscow|RU|55.75|37.82
Vostochnoe Degunino|Moscow|RU|55.88|37.56
Rawad|Ariana Governorate|TN|36.89|10.19
Cerete|Cordoba|CO|8.88|-75.79
Roquetas de Mar|Andalusia|ES|36.76|-2.61
Spokane Valley|WA|US|47.67|-117.24
Kanuma|Tochigi|JP|36.55|139.73
As Salamiyah|Hama|SY|35.01|37.05
Parli Vaijnath|Maharashtra|IN|18.85|76.53
Binh Minh|Vinh Long|VN|10.07|105.82
Alkmaar|North Holland|NL|52.63|4.75
Tiko|South-West|CM|4.08|9.36
Wuchang|Heilongjiang|CN|44.93|127.16
Djougou|Donga|BJ|9.71|1.67
Aracruz|Espirito Santo|BR|-19.82|-40.27
Leskovac|Central Serbia|RS|43|21.95
Behshahr|Mazandaran|IR|36.69|53.55
Hanamaki|Iwate|JP|39.38|141.12
Tiflet|Rabat-Sale-Kenitra|MA|33.89|-6.31
Fordham|NY|US|40.86|-73.9
Biba|Beni Suweif|EG|28.92|30.99
Sanjo|Niigata|JP|37.62|138.95
Nemby|Central Department|PY|-25.39|-57.54
Livonia|MI|US|42.37|-83.35
Al Qurayn|Sharqia|EG|30.62|31.74
Mainpuri|Uttar Pradesh|IN|27.23|79.03
Jacana|Sao Paulo|BR|-23.46|-46.57
Khamgaon|Maharashtra|IN|20.71|76.57
Anusawari|Bangkok|TH|13.89|100.61
Roswell|GA|US|34.02|-84.36
Aksum|Tigray|ET|14.12|38.72
Makrana|Rajasthan|IN|27.04|74.72
Yonezawa|Yamagata|JP|37.91|140.12
Sao Joao del Rei|Minas Gerais|BR|-21.14|-44.26
Orem|UT|US|40.3|-111.69
Allinagaram|Tamil Nadu|IN|10.03|77.48
Dunhou|Jiangxi|CN|27.05|114.9
Bayan Hot|Inner Mongolia|CN|38.84|105.67
Ximeicun|Fujian|CN|24.99|118.39
Yuzivskyi|Donetsk|UA|48|37.8
Azumino|Nagano|JP|36.29|137.89
Daxi|Taiwan|TW|24.88|121.29
Novyy Urengoy|Yamalo-Nenets|RU|66.08|76.63
Boryeong|Chungcheongnam-do|KR|36.35|126.6
Yilan|Taiwan|TW|24.76|121.75
Awsim|Giza|EG|30.12|31.14
Gjakove|Gjakova|XK|42.38|20.43
Ruwa|Mashonaland East Province|ZW|-17.89|31.24
Song Cau|Dak Lak|VN|13.46|109.22
Pendang|Kedah|MY|6|100.48
Chomedey|Quebec|CA|45.53|-73.75
Paracatu|Minas Gerais|BR|-17.22|-46.87
Fall River|MA|US|41.7|-71.16
Cacem|Lisbon|PT|38.77|-9.3
Gudiyatham|Tamil Nadu|IN|12.95|78.87
Zhongduo|Chongqing|CN|28.85|108.76
Hayes|England|GB|51.52|-0.42
Ashiya|Hyogo|JP|34.73|135.3
Dhar|Madhya Pradesh|IN|22.59|75.3
Lawrence|KS|US|38.97|-95.24
Gambat|Sindh|PK|27.35|68.52
Gesundbrunnen|State of Berlin|DE|52.55|13.39
Novoural'sk|Sverdlovsk Oblast|RU|57.25|60.09
The Woodlands|TX|US|30.16|-95.49
Zheleznogorsk|Krasnoyarsk Krai|RU|56.25|93.53
Bandar Kinrara|Selangor|MY|3.05|101.64
Fangcheng|Henan|CN|33.26|113
West Albany|NY|US|42.68|-73.78
Khuong GJinh|Hanoi|VN|20.98|105.82
Norrkoeping|OEstergoetland|SE|58.59|16.18
Bohicon|Zou|BJ|7.18|2.07
Daotian|Shandong|CN|36.83|118.9
Yakima|WA|US|46.6|-120.51
Kharkivskyi Masyv|Kyiv City|UA|50.41|30.66
Yunnanyi|Yunnan|CN|25.42|100.69
Shuangliao|Jilin|CN|43.51|123.5
Mogi Mirim|Sao Paulo|BR|-22.43|-46.96
Lajeado|Rio Grande do Sul|BR|-29.47|-51.96
Garcia|Nuevo Leon|MX|25.8|-100.59
Quincy|MA|US|42.25|-71
Aflou|Laghouat|DZ|34.11|2.1
Yala|Yala|TH|6.54|101.28
Dipolog|Zamboanga Peninsula|PH|8.57|123.33
Al-Qasim|Babil|IQ|32.3|44.68
Baraut|Uttar Pradesh|IN|29.1|77.26
Zhaoyuan|Heilongjiang|CN|45.52|125.08
Michurinsk|Tambov Oblast|RU|52.91|40.48
Kuala Nerus|Terengganu|MY|5.37|103.02
Kribi|South|CM|2.94|9.91
Guadalajara|Castille-La Mancha|ES|40.63|-3.16
Dueren|North Rhine-Westphalia|DE|50.8|6.49
Ceske Budejovice|South Bohemian Region|CZ|48.97|14.47
Fuwwah|Kafr el-Sheikh|EG|31.2|30.55
Yashio|Saitama|JP|35.82|139.84
Flatbush|NY|US|40.65|-73.96
Lysychansk|Luhansk|UA|48.91|38.42
Monastir|Monastir Governorate|TN|35.78|10.83
Harlow|England|GB|51.78|0.11
Dalai|Jilin|CN|45.5|124.3
Hesperia|CA|US|34.43|-117.3
Lere|Kaduna State|NG|10.39|8.57
La Spezia|Liguria|IT|44.1|9.82
Carson|CA|US|33.83|-118.28
Barletta|Apulia|IT|41.31|16.28
Modi'in Makkabbim Re'ut|Central District|IL|31.89|35.02
Polatli|Ankara|TR|39.58|32.14
Tangwu|Shandong|CN|36.45|118.86
Boca Raton|FL|US|26.36|-80.08
Jiayue|Shandong|CN|36.02|119.18
Budapest XVIII. keruelet|Budapest|HU|47.44|19.18
Santa Monica|CA|US|34.02|-118.49
Kalibo|Western Visayas|PH|11.71|122.36
Rubio|Tachira|VE|7.7|-72.36
Praga Polnoc|Mazovia|PL|52.25|21.03
Kalyani|West Bengal|IN|22.98|88.43
Changping|Beijing|CN|40.22|116.23
Inagi|Tokyo|JP|35.63|139.5
Ramnicu Valcea|Valcea County|RO|45.1|24.37
Obu|Aichi|JP|35.02|136.95
Galle|Southern Province|LK|6.05|80.21
Stilfontein|North West|ZA|-26.84|26.77
Doddaballapura|Karnataka|IN|13.29|77.54
Heerlen|Limburg|NL|50.88|5.98
Ozamiz City|Northern Mindanao|PH|8.15|123.84
Lorca|Murcia|ES|37.67|-1.7
Itajuba|Minas Gerais|BR|-22.43|-45.45
Qonce|Eastern Cape|ZA|-32.88|27.39
Jinja|Eastern Region|UG|0.44|33.2
Noumea|South Province|NC|-22.27|166.45
Kitakami|Iwate|JP|39.28|141.12
Heho|Shan State|MM|20.72|96.82
Kalaw|Shan State|MM|20.63|96.56
Osnovyanskyi|Kharkiv|UA|49.94|36.24
Wonosobo|Central Java|ID|-7.36|109.9
La Marsa|Tunis Governorate|TN|36.88|10.32
Kineshma|Ivanovo Oblast|RU|57.44|42.13
Negage|Uige|AO|-7.76|15.27
Bafra|Samsun|TR|41.57|35.9
Chirala|Andhra Pradesh|IN|15.82|80.35
Wukari|Taraba State|NG|7.87|9.78
Krasnogorsk|Moscow Oblast|RU|55.82|37.33
San Marcos|CA|US|33.14|-117.17
Pushkin|St.-Petersburg|RU|59.71|30.4
Hastings|England|GB|50.86|0.58
Moa|Holguin Province|CU|20.66|-74.95
Lianzhou|Guangdong|CN|24.78|112.37
Sunyani|Bono|GH|7.34|-2.33
Malacatan|San Marcos|GT|14.91|-92.06
Avare|Sao Paulo|BR|-23.1|-48.93
Boyle Heights|CA|US|34.03|-118.21
Magadan|Magadan Oblast|RU|59.56|150.8
Banco Filipino Homes|National Capital Region|PH|14.43|121.02
Beni Mered|Blida|DZ|36.52|2.86
Igbo-Ora|Oyo State|NG|7.43|3.29
Cajamar|Sao Paulo|BR|-23.36|-46.88
High Peak|England|GB|53.37|-1.85
Akot|Maharashtra|IN|21.1|77.06
Kaizuka|Osaka|JP|34.45|135.35
Palimanan|West Java|ID|-6.71|108.42
Fatehpur|Rajasthan|IN|27.99|74.96
Patos|Paraiba|BR|-7.02|-37.28
Yingqiu|Shandong|CN|36.53|118.99
Plantation|FL|US|26.13|-80.23
Grudziadz|Kujawsko-Pomorskie|PL|53.48|18.75
Gharroli|Delhi|IN|28.62|77.33
Njombe|Njombe|TZ|-9.35|34.77
Rahlstedt|Hamburg|DE|53.6|10.16
Semenyih|Selangor|MY|2.95|101.84
Maizuru|Kyoto|JP|35.45|135.33
Selong|West Nusa Tenggara|ID|-8.65|116.53
Concepcion|Zulia|VE|10.41|-71.69
Lynn|MA|US|42.47|-70.95
Villa Maria|Cordoba|AR|-32.41|-63.24
Ratchaburi|Ratchaburi|TH|13.54|99.82
Pamekasan|East Java|ID|-7.16|113.47
Gravata|Pernambuco|BR|-8.2|-35.56
Clementi Housing Estate||SG|1.32|103.76
Sendai|Kagoshima|JP|31.82|130.3
Al Harithah|Basra|IQ|30.58|47.76
Esslingen|Baden-Wurttemberg|DE|48.74|9.3
Darlington|England|GB|54.52|-1.55
Mugla|Mugla|TR|37.22|28.37
Bang Phlat|Bangkok|TH|13.79|100.5
Tuebingen|Baden-Wurttemberg|DE|48.52|9.05
Pandeglang|Banten|ID|-6.31|106.11
Miami Beach|FL|US|25.79|-80.13
Rajpura|Punjab|IN|30.48|76.59
Lucas do Rio Verde|Mato Grosso|BR|-13.07|-55.91
Sibolga|North Sumatra|ID|1.74|98.78
Serra Talhada|Pernambuco|BR|-7.99|-38.3
Sakai|Fukui|JP|36.15|136.19
Vila Formosa|Sao Paulo|BR|-23.57|-46.55
Arden-Arcade|CA|US|38.6|-121.38
Pariaman|West Sumatra|ID|-0.62|100.12
Kudus|Central Java|ID|-6.8|110.84
Ballarpur|Maharashtra|IN|19.85|79.35
Rohri|Sindh|PK|27.69|68.9
Westminster|CA|US|33.76|-118.01
Alessandria|Piedmont|IT|44.91|8.61
Longonjo|Huambo|AO|-12.91|15.25
Longmont|CO|US|40.17|-105.1
Hohoe|Volta|GH|7.15|0.47
Delmas|Mpumalanga|ZA|-26.15|28.68
Nasinu|Central|FJ|-18.07|178.51
Duitama|Boyaca|CO|5.82|-73.03
Muan|Jeollanam-do|KR|34.99|126.48
Danjiangkou|Hubei|CN|32.54|111.51
Kot Kapura|Punjab|IN|30.58|74.83
Tepatitlan de Morelos|Jalisco|MX|20.82|-102.76
Bai'anba|Chongqing|CN|30.76|108.44
Kabirwala|Punjab|PK|30.4|71.86
Ercis|Van|TR|39.03|43.36
Bugulma|Tatarstan Republic|RU|54.54|52.8
El Shorouk|Cairo|EG|30.14|31.62
Sassari|Sardinia|IT|40.73|8.56
Kilosa|Morogoro|TZ|-6.83|36.98
Manhuacu|Minas Gerais|BR|-20.26|-42.03
Caringin|West Java|ID|-6.71|106.82
Bhandara|Maharashtra|IN|21.17|79.65
Santa Barbara|CA|US|34.42|-119.7
Ubatuba|Sao Paulo|BR|-23.43|-45.07
Iserlohn|North Rhine-Westphalia|DE|51.38|7.7
Witten|North Rhine-Westphalia|DE|51.44|7.35
Nisshin|Aichi|JP|35.14|137.05
Higashi-Matsuyama|Saitama|JP|36.03|139.42
Cuamba|Niassa Province|MZ|-14.8|36.54
Stevenage|England|GB|51.9|-0.2
Sao Joao da Boa Vista|Sao Paulo|BR|-21.97|-46.8
Pickering|Ontario|CA|43.9|-79.13
Cidade Ocidental|Goias|BR|-16.11|-47.93
Zhongshu|Yunnan|CN|24.52|103.77
Tuerkmenbasy|Balkan|TM|40.02|52.96
Southport|England|GB|53.65|-3.01
Huazhou|Guangdong|CN|21.63|110.58
Phu Tho|Phu Tho|VN|21.4|105.22
Ratingen|North Rhine-Westphalia|DE|51.3|6.85
Porto Amboim|Kwanza Sul|AO|-10.73|13.77
Soran|Erbil|IQ|36.66|44.54
Redding|CA|US|40.59|-122.39
Xingren|Guizhou|CN|25.43|105.23
Cardenas|Tabasco|MX|18|-93.38
Grahamstown|Eastern Cape|ZA|-33.3|26.53
Banga|Soccsksargen|PH|6.42|124.78
Longquan|Yunnan|CN|24.67|102.16
Kalamaria|Central Macedonia|GR|40.58|22.95
Yatou|Shandong|CN|37.16|122.44
Tanfang|Shandong|CN|36.7|118.67
Kars|Kars Province|TR|40.6|43.09
Patrocinio|Minas Gerais|BR|-18.94|-46.99
Surallah|Soccsksargen|PH|6.38|124.75
Lodja|Sankuru|CD|-3.52|23.6
Tartu|Tartu|EE|58.38|26.73
Sablayan|Mimaropa|PH|12.83|120.77
Molarband|Delhi|IN|28.5|77.31
Pergamino|Buenos Aires|AR|-33.89|-60.57
Marl|North Rhine-Westphalia|DE|51.66|7.09
Macon|GA|US|32.84|-83.63
Bach Mai|Hanoi|VN|20.98|105.83
Jirapa|Upper West|GH|10.54|-2.7
Rayachoti|Andhra Pradesh|IN|14.06|78.75
Aruja|Sao Paulo|BR|-23.4|-46.32
Al Minshah|Sohag|EG|26.48|31.8
Daisen|Akita|JP|39.44|140.49
Nakonde|Muchinga|ZM|-9.34|32.74
Bethlehem|Free State|ZA|-28.23|28.31
Nigde|Nigde Province|TR|37.97|34.68
Newmarket|Ontario|CA|44.05|-79.47
Luenen|North Rhine-Westphalia|DE|51.62|7.53
Yaroslavskiy|Moscow|RU|55.88|37.72
Lefortovo|Moscow|RU|55.77|37.7
Launceston|Tasmania|AU|-41.44|147.13
Ga-Rankuwa|North West|ZA|-25.62|27.99
Gaoyou|Jiangsu|CN|32.79|119.44
Kunjah|Punjab|PK|32.53|73.97
Lueleburgaz|Kirklareli|TR|41.4|27.36
Myitkyina|Kachin State|MM|25.38|97.4
Lqoliaa|Souss-Massa|MA|30.3|-9.47
Yulinshi|Shaanxi|CN|38.29|109.74
Chauk|Magway|MM|20.9|94.82
Al Badrashayn|Giza|EG|29.85|31.27
Thakhek|Khammouane Province|LA|17.41|104.83
Chinhoyi|Mashonaland West|ZW|-17.37|30.2
Namyangju|Gyeonggi-do|KR|37.64|127.21
'Amran|Omran|YE|15.66|43.94
Imizu|Toyama|JP|36.77|137.13
Meridian|ID|US|43.61|-116.39
San Leandro|CA|US|37.72|-122.16
Kishorganj|Dhaka Division|BD|24.44|90.78
Caratinga|Minas Gerais|BR|-19.79|-42.14
Mtwapa|Kilifi County|KE|-3.94|39.75
Emure-Ekiti|Ekiti State|NG|7.44|5.46
Hanting|Shandong|CN|36.77|119.21
Bohodukhivskyi|Donetsk|UA|47.97|37.86
Kattaqo'rg'on Shahri|Samarqand Region|UZ|39.91|66.27
Greenville|NC|US|35.61|-77.37
Hradec Kralove|Hradec Kralove Region|CZ|50.21|15.83
Tongren|Guizhou|CN|27.72|109.19
Saquarema|Rio de Janeiro|BR|-22.9|-42.47
Koerfez|Kocaeli|TR|40.77|29.78
Mihara|Hiroshima|JP|34.4|133.08
Cankiri|Cankiri|TR|40.6|33.62
Eslamabad-e Gharb|Kermanshah Province|IR|34.11|46.53
Chester|England|GB|53.19|-2.89
Mohammadiyeh|Qazvin Province|IR|36.22|50.18
Retalhuleu|Retalhuleu|GT|14.54|-91.68
Araripina|Pernambuco|BR|-7.58|-40.5
Nanaimo|British Columbia|CA|49.17|-123.94
Ziway|Oromiya|ET|7.93|38.72
Palmerston North|Manawatu-Wanganui|NZ|-40.36|175.61
Kuznetsk|Penza Oblast|RU|53.12|46.6
Tual|Maluku|ID|-5.63|132.75
Montelibano|Cordoba|CO|7.98|-75.42
Xihe|Hubei|CN|31.69|113.47
Guliston|Sirdaryo Region|UZ|40.5|68.78
San Juan Bautista|Nueva Esparta|VE|11.01|-63.94
Usti nad Labem|Usti nad Labem Region|CZ|50.66|14.03
Cubal|Benguela|AO|-13.04|14.25
Kadayanallur|Tamil Nadu|IN|9.07|77.34
Phra Khanong|Bangkok|TH|13.7|100.6
Valparai|Tamil Nadu|IN|10.33|76.95
Masvingo|Masvingo Province|ZW|-20.06|30.83
Abu Qurqas|Minya|EG|27.93|30.84
Duobao|Hubei|CN|30.67|112.69
Kirovo-Chepetsk|Kirov Oblast|RU|58.55|50.03
Berdsk|Novosibirsk Oblast|RU|54.75|83.1
Bougouni|Sikasso|ML|11.42|-7.48
Bela Bela|Limpopo|ZA|-24.88|28.28
Pleven|Pleven|BG|43.42|24.62
Reconquista|Santa Fe|AR|-29.15|-59.65
Huddinge|Stockholm|SE|59.24|17.98
Pollachi|Tamil Nadu|IN|10.66|77.01
Daharki|Sindh|PK|28.05|69.7
Prosperidad|Caraga|PH|8.58|125.9
El Khroub|Constantine|DZ|36.26|6.69
Alabel|Soccsksargen|PH|6.1|125.29
Wajir|Wajir County|KE|1.75|40.06
Marudi|Sarawak|MY|4.18|114.32
New Plymouth|Taranaki Region|NZ|-39.07|174.08
Kavali|Andhra Pradesh|IN|14.92|79.99
Edmond|OK|US|35.65|-97.48
Wembley|England|GB|51.55|-0.3
Airdrie|Alberta|CA|51.3|-114.04
San Vicente|Buenos Aires|AR|-35.02|-58.42
Botosani|Botosani County|RO|47.75|26.67
Dubai Silicon Oasis|Dubai|AE|25.12|55.39
Cela|Kwanza Sul|AO|-11.42|15.12
Cafunfo|Luanda Norte|AO|-8.77|18
Quissecula|Kwanza Sul|AO|-11.39|15.09
Kanata|Ontario|CA|45.3|-75.92
Roha|Maharashtra|IN|18.44|73.12
Alvand|Qazvin Province|IR|36.19|50.06
Chinatown|NY|US|40.72|-74
Luomen|Gansu|CN|34.75|105.02
Fort-de-France|Martinique|MQ|14.6|-61.07
Ancona|The Marches|IT|43.61|13.51
Isieke|Ebonyi State|NG|6.38|8.04
Huaidian|Henan|CN|33.43|115.03
Mancherial|Telangana|IN|18.87|79.43
Dinga|Punjab|PK|32.64|73.72
Kwail-up|South Hwanghae|KP|38.45|125.02
Ponte Rasa|Sao Paulo|BR|-23.52|-46.49
Mogok|Mandalay Region|MM|22.92|96.51
Nampa|ID|US|43.54|-116.56
Saphan Sung|Bangkok|TH|13.77|100.68
Point Pedro|Northern Province|LK|9.82|80.23
Butajira|Central Ethiopia Regional State|ET|8.12|38.37
Avignon|Provence-Alpes-Cote d'Azur|FR|43.95|4.81
Gatchina|Leningradskaya Oblast'|RU|59.58|30.13
Baisha|Guangxi|CN|21.72|109.68
Grays|England|GB|51.48|0.33
Msaken|Sousse Governorate|TN|35.73|10.58
Itapeva|Sao Paulo|BR|-23.98|-48.88
Olavarria|Buenos Aires|AR|-36.89|-60.32
Masasi|Mtwara|TZ|-10.72|38.8
Lillestrom|Akershus|NO|59.96|11.05
Caceres|Mato Grosso|BR|-16.07|-57.68
Calauan|Calabarzon|PH|14.15|121.32
Avaniyapuram|Tamil Nadu|IN|9.88|78.11
Nyaunglebin|Bago Region|MM|17.95|96.72
Trenton|NJ|US|40.22|-74.74
Koka|Shiga|JP|34.98|136.16
Sangyoung|Yangon|MM|16.81|96.13
Miaohang|Shanghai|CN|31.32|121.44
Maitland|New South Wales|AU|-32.73|151.56
Sandy Hills|UT|US|40.58|-111.85
Aricanduva|Sao Paulo|BR|-23.57|-46.52
Muradnagar|Uttar Pradesh|IN|28.78|77.5
Tuggeranong|Australian Capital Territory|AU|-35.42|149.07
Ankleshwar|Gujarat|IN|21.63|72.99
Circoiscrizione VII|Piedmont|IT|45.08|7.7
Fujin|Heilongjiang|CN|47.25|132.03
Yoff|Dakar|SN|14.75|-17.49
Kadiri|Andhra Pradesh|IN|14.11|78.16
Granada|Granada Department|NI|11.93|-85.95
Nikaia|Attica|GR|37.97|23.65
Tan Binh|Ho Chi Minh City (HCMC)|VN|10.8|106.66
Katwa|North Kivu|CD|0.09|29.31
Mulongo|Haut-Lomami|CD|-7.83|27
Marseille 13|Provence-Alpes-Cote d'Azur|FR|43.32|5.41
Lankaran|Lankaran|AZ|38.75|48.85
Huaicheng|Guangdong|CN|23.92|112.18
Shahdol|Madhya Pradesh|IN|23.29|81.36
Shrirampur|Maharashtra|IN|19.62|74.66
Kwangyang|Jeollanam-do|KR|34.98|127.59
Aligudarz|Lorestan Province|IR|33.4|49.69
Undok|North Hamgyong|KP|42.52|130.33
Houmt Souk|Medenine Governorate|TN|33.88|10.86
Miragoane|Nippes|HT|18.45|-73.09
Giessen|Hesse|DE|50.59|8.68
Polangui|Bicol Region|PH|13.29|123.49
Hongseong|Chungcheongnam-do|KR|36.6|126.67
Mahoba|Uttar Pradesh|IN|25.29|79.88
Guidonia Montecelio|Lazio|IT|41.99|12.72
Micheng|Yunnan|CN|25.34|100.49
Lorena|Sao Paulo|BR|-22.73|-45.12
Mudon|Mon|MM|16.26|97.72
Lucheng|Anhui|CN|31.23|117.28
Hede|Jiangsu|CN|33.77|120.26
Kuhdasht|Lorestan Province|IR|33.53|47.61
Chengxiang|Chongqing|CN|31.4|109.57
Cruzeiro do Sul|Acre|BR|-7.63|-72.68
Biyala|Kafr el-Sheikh|EG|31.17|31.22
Harrogate|England|GB|53.99|-1.54
Banjar|Bali|ID|-8.19|114.97
Bibir Hat|Chittagong|BD|22.68|91.79
Sambava|Sava|MG|-14.27|50.17
Gantang|Hunan|CN|27.44|111.97
Biryulevo Zapadnoye|Moscow|RU|55.59|37.65
Kholodna Hora|Kharkiv|UA|50|36.18
Nusaybin|Mardin|TR|37.07|41.21
Cicurug|West Java|ID|-6.78|106.78
Nandajie|Chongqing|CN|29.34|105.89
Lengshuitan|Hunan|CN|26.41|111.6
Kartasura|Central Java|ID|-7.55|110.74
Calabanga|Bicol Region|PH|13.71|123.21
Shwebo|Sagaing Region|MM|22.57|95.7
Iga|Mie|JP|34.76|136.13
Sao Domingos|Sao Paulo|BR|-23.49|-46.75
Talavera de la Reina|Castille-La Mancha|ES|39.96|-4.83
Hartlepool|England|GB|54.69|-1.21
Eregli|Zonguldak Province|TR|41.28|31.42
Fusagasuga|Cundinamarca|CO|4.34|-74.36
Mangaldan|Ilocos|PH|16.07|120.4
Newton|MA|US|42.34|-71.21
Nuneaton|England|GB|52.52|-1.47
Toms River|NJ|US|39.95|-74.2
Ramgarh|Jharkhand|IN|23.63|85.52
Habiganj|Sylhet Division|BD|24.38|91.41
Wangqing|Jilin|CN|43.31|129.76
Budapest II. keruelet|Budapest|HU|47.52|19.02
Rafaela|Santa Fe|AR|-31.25|-61.49
Carmel|IN|US|39.98|-86.12
Xiazhuang|Shandong|CN|36.45|119.84
Contai|West Bengal|IN|21.78|87.75
Khan Na Yao|Bangkok|TH|13.83|100.68
Hanau am Main|Hesse|DE|50.13|8.91
Montero|Santa Cruz Department|BO|-17.34|-63.25
Sangrur|Punjab|IN|30.25|75.84
Chosica|Lima region|PE|-11.94|-76.71
Val Dor|Penang|MY|5.25|100.49
Campo di Marte|Tuscany|IT|43.78|11.28
Alaghsas|Agadez|NE|17.02|8.02
Thul|Sindh|PK|28.24|68.78
Centro|Canary Islands|ES|28.13|-15.43
Gengqing|Sichuan|CN|31.82|98.58
Pardubice|Pardubice Region|CZ|50.04|15.78
Linjiacun|Shandong|CN|35.99|119.65
Zhoujiaba|Chongqing|CN|30.84|108.37
Barra do Corda|Maranhao|BR|-5.51|-45.24
Norwalk|CT|US|41.12|-73.41
Waukegan|IL|US|42.36|-87.84
Deltona|FL|US|28.9|-81.26
Takayama|Gifu|JP|36.13|137.25
Berisso|Buenos Aires|AR|-34.87|-57.88
La Haute-Saint-Charles|Quebec|CA|46.89|-71.37
Honghe|Shandong|CN|36.4|118.92
Hawthorne|CA|US|33.92|-118.35
Montepuez|Cabo Delgado Province|MZ|-13.13|39
Nirmal|Telangana|IN|19.1|78.34
Fulad Shahr|Isfahan|IR|32.49|51.4
Al Bahah|Al Bahah Region|SA|20.01|41.47
Fukuroi|Shizuoka|JP|34.75|137.92
Bhimdatta|Sudurpashchim Pradesh|NP|28.96|80.18
Klangenan|West Java|ID|-6.71|108.44
El Puerto de Santa Maria|Andalusia|ES|36.59|-6.23
Mobara|Chiba|JP|35.43|140.3
Ben Arous|Ben Arous Governorate|TN|36.75|10.22
Quixada|Ceara|BR|-4.97|-39.02
Cienaga|Magdalena Department|CO|11.01|-74.25
Le Kram|Tunis Governorate|TN|36.84|10.32
Hastings|Hawke's Bay Region|NZ|-39.64|176.85
Heroica Ciudad de Juchitan de Zaragoza|Oaxaca|MX|16.43|-95.02
Ifo|Ogun State|NG|6.81|3.2
Laem Chabang|Chon Buri|TH|13.09|100.88
Baixi|Sichuan|CN|28.7|104.55
Fort Smith|AR|US|35.39|-94.4
Deoband|Uttar Pradesh|IN|29.7|77.68
North Vancouver|British Columbia|CA|49.32|-123.07
Suffolk|VA|US|36.73|-76.58
Sugar Land|TX|US|29.62|-95.63
Livermore|CA|US|37.68|-121.77
Lidu|Chongqing|CN|29.74|107.29
Kozan|Adana|TR|37.46|35.82
Neyyattinkara|Kerala|IN|8.4|77.09
Tanda|Uttar Pradesh|IN|26.55|82.66
Bais|Central Visayas|PH|9.59|123.12
Mogoditshane|Kweneng|BW|-24.63|25.87
Nowshera Kalan|Khyber Pakhtunkhwa|PK|34.02|71.97
Taikkyi|Yangon|MM|17.31|95.96
Sarov|Nizhny Novgorod Oblast|RU|54.95|43.32
Arayat|Central Luzon|PH|15.15|120.77
Nashua|NH|US|42.77|-71.47
Yuzhou|Henan|CN|34.15|113.47
Qorveh|Kurdistan Province|IR|35.17|47.81
Samannud|Gharbia|EG|30.96|31.24
Yingge|Taipei|TW|24.96|121.35
Wakiso|Central Region|UG|0.4|32.46
Idiofa|Kwilu|CD|-4.97|19.59
Gusong|Sichuan|CN|28.31|105.24
Kolar|Madhya Pradesh|IN|23.16|77.42
Yozgat|Yozgat|TR|39.82|34.8
Al-Tabqa|Raqqa|SY|35.84|38.55
Reading|PA|US|40.34|-75.93
Jhumri Telaiya|Jharkhand|IN|24.43|85.53
Amsterdam-Zuidoost|North Holland|NL|52.31|4.97
Redditch|England|GB|52.31|-1.95
Surigao|Caraga|PH|9.79|125.5
Perus|Sao Paulo|BR|-23.4|-46.75
Balkanabat|Balkan|TM|39.51|54.37
Yeysk|Krasnodar Krai|RU|46.69|38.28
Tagaytay|Calabarzon|PH|14.1|120.93
Orang|North Hamgyong|KP|41.45|129.66
Arecibo|Arecibo|PR|18.47|-66.72
Hanchuan|Hubei|CN|30.65|113.77
Aruppukkottai|Tamil Nadu|IN|9.51|78.1
Takasago|Hyogo|JP|34.76|134.79
Maumere|East Nusa Tenggara|ID|-8.62|122.21
Buzuluk|Orenburg Oblast|RU|52.78|52.26
Dapitan|Zamboanga Peninsula|PH|8.66|123.42
Concord|NC|US|35.41|-80.58
Faridkot|Punjab|IN|30.67|74.76
Tiefu|Jiangsu|CN|34.53|118.03
Maco|Davao Region|PH|7.36|125.86
San Antonio|Valparaiso|CL|-33.59|-71.61
Velbert|North Rhine-Westphalia|DE|51.34|7.04
Kadugli|Southern Kordofan|SD|11.01|29.72
Qiongshan|Hainan|CN|20.01|110.35
Madgaon|Goa|IN|15.28|73.96
Gitarama|Southern Province|RW|-2.07|29.76
Ludwigsburg|Baden-Wurttemberg|DE|48.9|9.19
Deqing|Zhejiang|CN|30.54|119.96
Gurupi|Tocantins|BR|-11.73|-49.07
Indio|CA|US|33.72|-116.22
Rio Rancho|NM|US|35.23|-106.66
Enchanted Hills|NM|US|35.34|-106.59
Taroudant|Souss-Massa|MA|30.47|-8.88
Shevchenkivskyi|Luhansk|UA|48.56|39.33
Junin|Buenos Aires|AR|-34.59|-60.95
Santa Fe|NM|US|35.69|-105.94
Sandy|UT|US|40.59|-111.88
Xujiang|Jiangxi|CN|26.84|116.32
Settsu|Osaka|JP|34.78|135.6
Wonosari|Yogyakarta|ID|-7.97|110.6
Patnos|Agri|TR|39.22|42.86
Whittier|CA|US|33.98|-118.03
Velampalaiyam|Tamil Nadu|IN|11.14|77.31
Thuong Cat|Hanoi|VN|21.09|105.73
Ben Gardane|Medenine Governorate|TN|33.14|11.22
Bantayan|Central Visayas|PH|11.17|123.72
Midrand|Gauteng|ZA|-25.98|28.12
Maghnia|Tlemcen|DZ|34.85|-1.73
Canarsie|NY|US|40.64|-73.9
Jamui|Bihar|IN|24.93|86.23
Qaracuxur|Baki|AZ|40.4|49.97
Maladziecna|Minsk|BY|54.32|26.85
Bishan New Town||SG|1.35|103.85
Glyfada|Attica|GR|37.86|23.76
Lisovyi Masyv|Kyiv City|UA|50.47|30.63
Igede-Ekiti|Ekiti State|NG|7.67|5.13
Kirkland|WA|US|47.68|-122.21
Ende|East Nusa Tenggara|ID|-8.84|121.66
Mishan|Heilongjiang|CN|45.55|131.88
Lund|Skane|SE|55.71|13.19
Nenjiang|Heilongjiang|CN|49.17|125.22
Sefrou|Fes-Meknes|MA|33.83|-4.83
Anjar|Gujarat|IN|23.11|70.03
Menifee|CA|US|33.73|-117.15
Cornella de Llobregat|Catalonia|ES|41.35|2.08
Fulham|England|GB|51.48|-0.2
Londonderry County Borough|Northern Ireland|GB|55|-7.31
Paralakhemundi|Odisha|IN|18.78|84.1
Hounde|Hauts-Bassins|BF|11.5|-3.52
Brindisi|Apulia|IT|40.63|17.94
Newport Beach|CA|US|33.62|-117.93
Tracy|CA|US|37.74|-121.43
Ad Douiem|White Nile|SD|14|32.31
Citrus Heights|CA|US|38.71|-121.28
Norton|Mashonaland West|ZW|-17.88|30.7
Bend|OR|US|44.06|-121.32
Lerik|Lerik District|AZ|38.77|48.41
Gubkin|Belgorod Oblast|RU|51.28|37.54
Vavoua|Sassandra-Marahoue|CI|7.38|-6.48
Brigittenau|Vienna|AT|48.24|16.38
Effium|Ebonyi State|NG|6.63|8.06
Jharia|Jharkhand|IN|23.74|86.41
Hacienda Santa Fe|Jalisco|MX|20.52|-103.38
Kongolo|Tanganyika|CD|-5.39|27
Ban Mai|Songkhla|TH|7.2|100.55
Son Tra|Da Nang City|VN|16.06|108.23
Menglang|Yunnan|CN|22.56|99.91
San Ramon de la Nueva Oran|Salta|AR|-23.14|-64.32
Ad Dawadimi|Riyadh Region|SA|24.51|44.39
Campana|Buenos Aires|AR|-34.16|-58.96
Montreal-Nord|Quebec|CA|45.6|-73.63
Louis Trichardt|Limpopo|ZA|-23.04|29.9
Karaikal|Puducherry|IN|10.92|79.83
Canton|MI|US|42.31|-83.48
Caguas|Caguas|PR|18.23|-66.05
Kamthi|Maharashtra|IN|21.22|79.2
Lehigh Acres|FL|US|26.63|-81.62
Hansi|Haryana|IN|29.1|75.96
Greenburgh|NY|US|41.03|-73.84
Kasoa|Central|GH|5.53|-0.42
Shizilu|Shandong|CN|35.17|118.83
Asnieres-sur-Seine|Ile-de-France|FR|48.92|2.28
Batticaloa|Eastern Province|LK|7.71|81.69
Nanterre|Ile-de-France|FR|48.89|2.21
Gbawe|Greater Accra|GH|5.58|-0.31
Tumaco|Narino|CO|1.79|-78.79
Chaykovskiy|Perm Krai|RU|56.76|54.11
Rat Burana|Bangkok|TH|13.68|100.51
Atlixco|Puebla|MX|18.91|-98.44
Brno stred|South Moravian|CZ|49.19|16.61
Ixelles|Brussels Capital|BE|50.83|4.37
Mayiladuthurai|Tamil Nadu|IN|11.1|79.66
Podilskyi|Kirovohrad|UA|48.5|32.28
Jiangshan|Shandong|CN|36.68|120.53
Hualpen|Biobio|CL|-36.79|-73.1
Paraiso|Tabasco|MX|18.4|-93.21
Vinh Tuy|Hanoi|VN|21|105.88
Gotemba|Shizuoka|JP|35.32|138.94
Abu an Numrus|Giza|EG|29.95|31.2
Bojonegoro|East Java|ID|-7.15|111.88
Zhaogezhuang|Hebei|CN|39.77|118.41
Toledo|Castille-La Mancha|ES|39.86|-4.02
Al Farwaniyah|Al Farwaniyah|KW|29.28|47.96
Anakapalle|Andhra Pradesh|IN|17.69|83
Victorias|Western Visayas|PH|10.9|123.07
Hamakita|Shizuoka|JP|34.8|137.78
Tulcan|Carchi|EC|0.81|-77.72
Idanre|Ondo State|NG|7.11|5.12
Apartado|Antioquia|CO|7.88|-76.63
Bloomington|MN|US|44.84|-93.3
West Town|IL|US|41.89|-87.67
Amsterdam-Centrum|North Holland|NL|52.37|4.9
Anlong|Guizhou|CN|25.1|105.52
Tagbilaran City|Central Visayas|PH|9.66|123.85
Puli|Taiwan|TW|23.97|120.97
Navegantes|Santa Catarina|BR|-26.9|-48.65
Germantown|MD|US|39.17|-77.27
Kitanagoya|Aichi|JP|35.25|136.88
Le Sud-Ouest|Quebec|CA|45.47|-73.59
Gyoda|Saitama|JP|36.14|139.46
Clifton|NJ|US|40.86|-74.16
Nitra|Nitra Region|SK|48.31|18.08
Miaoli|Taiwan|TW|24.56|120.82
Qamdo|Tibet|CN|31.13|97.18
Cai Rang|Can Tho City|VN|10|105.75
Kampung Manjoi|Perak|MY|4.62|101.07
Dunkirk|Hauts-de-France|FR|51.03|2.38
Bangkalan|East Java|ID|-7.05|112.74
Chigorodo|Antioquia|CO|7.67|-76.68
Kasihan|Yogyakarta|ID|-7.83|110.33
Viacha|La Paz Department|BO|-16.65|-68.3
Maduravoyal|Tamil Nadu|IN|13.07|80.16
Ibshaway|Faiyum|EG|29.36|30.68
Kashiwazaki|Niigata|JP|37.37|138.55
Lyon 08|Auvergne-Rhone-Alpes|FR|45.74|4.87
Sarni|Madhya Pradesh|IN|22.1|78.17
Grimsby|England|GB|53.57|-0.08
Nanfeng|Guangdong|CN|23.73|111.8
Ama|Aichi|JP|35.18|136.8
Cannock|England|GB|52.69|-2.03
Duluth|MN|US|46.78|-92.11
Moncton|New Brunswick|CA|46.09|-64.8
Rutoma|Western Region|UG|-0.57|30.38
Champaign|IL|US|40.12|-88.24
Volos|Thessaly|GR|39.37|22.95
Samch'on|South Hwanghae|KP|38.36|125.33
Gbarnga|Bong County|LR|7|-9.47
Potiskum|Yobe State|NG|11.71|11.08
Ar Rumaylah|Ajman|AE|25.4|55.43
Tajrish|Tehran|IR|35.8|51.43
Lianozovo|Moscow|RU|55.9|37.59
Babushkin|Moscow|RU|55.87|37.73
Novi Pazar|Central Serbia|RS|43.14|20.51
Melilla|Melilla|ES|35.29|-2.94
Poitiers|New Aquitaine|FR|46.58|0.34
Dausa|Rajasthan|IN|26.89|76.34
Kepong|Kuala Lumpur|MY|3.21|101.64
Keffi|Nasarawa State|NG|8.85|7.87
Coari|Amazonas|BR|-4.08|-63.14
Galway|Connacht|IE|53.27|-9.05
Usol'ye-Sibirskoye|Irkutsk Oblast|RU|52.75|103.65
Bukit Timah||SG|1.33|103.79
Cacoal|Rondonia|BR|-11.44|-61.45
Lichterfelde|State of Berlin|DE|52.43|13.31
Panevezys|Panevezys|LT|55.73|24.36
Zhonggulou|Chongqing|CN|30.82|108.38
Paradip Garh|Odisha|IN|20.32|86.61
Heidelberg|Gauteng|ZA|-26.5|28.36
Makoko|Lagos|NG|6.5|3.39
Flensburg|Schleswig-Holstein|DE|54.79|9.44
Longnan|Gansu|CN|33.4|104.92
Peterborough|Ontario|CA|44.3|-78.32
Agua Rasa|Sao Paulo|BR|-23.57|-46.57
Ryugasaki|Ibaraki|JP|35.9|140.18
Treviso|Veneto|IT|45.67|12.24
Helong|Jilin|CN|42.54|129
Near North Side|IL|US|41.9|-87.63
Tecoman|Colima|MX|18.92|-103.88
Penaflor|Santiago Metropolitan|CL|-33.61|-70.88
Kosmichnyi|Zaporizhzhia|UA|47.78|35.22
Obruchevo|Moscow|RU|55.66|37.52
Adwa|Tigray|ET|14.16|38.9
Esmeraldas|Minas Gerais|BR|-19.76|-44.31
Chino|CA|US|34.01|-117.69
Arauca|Arauca Department|CO|7.08|-70.76
El Bayadh|El Bayadh|DZ|33.68|1.02
Mukachevo|Zakarpattia|UA|48.44|22.72
Krasnaya Glinka|Orenburg Oblast|RU|53.74|52.94
Redencao|Para|BR|-8.03|-50.03
Yokote|Akita|JP|39.32|140.55
Alhambra|CA|US|34.1|-118.13
Svetlanovskiy|Leningradskaya Oblast'|RU|60|30.33
Bangil|East Java|ID|-7.6|112.82
GJinh Cong|Hanoi|VN|20.98|105.83
Nanding|Shandong|CN|36.75|118.06
Birni N Konni|Tahoua Region|NE|13.8|5.25
Moriyama|Shiga|JP|35.07|135.98
Ogden|UT|US|41.22|-111.97
Soc Son|Hanoi|VN|21.26|105.85
Lakang|Kachin State|MM|24.66|97.19
Versailles|Ile-de-France|FR|48.8|2.13
Guozhen|Shaanxi|CN|34.37|107.36
Voznesenskyi|Donetsk|UA|47.93|37.63
Sandnes|Rogaland|NO|58.85|5.74
Khalifah A City|Abu Dhabi|AE|24.43|54.6
Tarut|Eastern Province|SA|26.57|50.04
Los Reyes Acaquilpan|Mexico|MX|19.36|-98.98
Maun|North-West|BW|-19.98|23.42
Santo Amaro|Sao Paulo|BR|-23.65|-46.7
Torre del Greco|Campania|IT|40.79|14.37
Al Marj|Al Marj|LY|32.49|20.83
Lido di Ostia|Lazio|IT|41.73|12.28
Redwood City|CA|US|37.49|-122.24
Sekimachi|Gifu|JP|35.48|136.92
Dengzhou|Shandong|CN|37.81|120.76
Wedding|State of Berlin|DE|52.55|13.36
Bonab|East Azerbaijan|IR|37.34|46.06
Mehestan|Alborz Province|IR|35.99|50.75
Yegor'yevsk|Moscow Oblast|RU|55.38|39.04
Goiana|Pernambuco|BR|-7.56|-35
Courbevoie|Ile-de-France|FR|48.9|2.26
Bellingham|WA|US|48.76|-122.49
Qufu|Shandong|CN|35.6|116.99
Essaouira|Marrakesh-Safi|MA|31.51|-9.77
Makeni|Northern Province|SL|8.89|-12.04
Iwamizawa|Hokkaido|JP|43.2|141.76
Hingoli|Maharashtra|IN|19.71|77.14
Gia Nghia|Lam Dong|VN|12|107.69
Munoz|Central Luzon|PH|15.72|120.9
Monte Chingolo|Buenos Aires|AR|-34.73|-58.35
O'Fallon|MO|US|38.81|-90.7
Puerto Maldonado|Madre de Dios|PE|-12.59|-69.2
Santa Ines|Maranhao|BR|-3.67|-45.38
Mohammed Bin Zayed City|Abu Dhabi|AE|24.35|54.55
Sintang|West Kalimantan|ID|0.07|111.5
Rukban|Mafraq|JO|33.31|38.7
Damansara Damai|Selangor|MY|3.2|101.59
Vwawa|Songwe|TZ|-9.11|32.93
Repentigny|Quebec|CA|45.74|-73.45
Gonaives|Artibonite|HT|19.45|-72.69
Unai|Minas Gerais|BR|-16.36|-46.91
Guanambi|Bahia|BR|-14.22|-42.78
Sathon|Bangkok|TH|13.71|100.53
Baruni|Bihar|IN|25.48|85.97
Hoover|AL|US|33.41|-86.81
Creteil|Ile-de-France|FR|48.79|2.47
Jeypore|Odisha|IN|18.86|82.57
Como|Lombardy|IT|45.81|9.08
Ilion|Attica|GR|38.03|23.7
Madaripur|Dhaka Division|BD|23.17|90.21
Ciudad Mante|Tamaulipas|MX|22.74|-98.97
Konotop|Sumy|UA|51.23|33.2
Ijui|Rio Grande do Sul|BR|-28.39|-53.91
Pato Branco|Parana|BR|-26.23|-52.67
Rivera|Rivera Department|UY|-30.91|-55.55
Komae|Tokyo|JP|35.63|139.58
Laojunmiao|Gansu|CN|39.83|97.73
Cottbus|Brandenburg|DE|51.76|14.33
Tuxpam de Rodriguez Cano|Veracruz|MX|20.96|-97.41
Seropedica|Rio de Janeiro|BR|-22.74|-43.71
Chiguayante|Biobio|CL|-36.93|-73.03
Epe|Lagos|NG|6.58|3.98
El Ejido|Andalusia|ES|36.78|-2.81
Nakatsu|Oita|JP|33.6|131.19
Al-Manakh|Port Said|EG|31.27|32.28
Melbourne|FL|US|28.08|-80.61
Gamboru|Borno State|NG|12.37|14.21
Dien Bien Phu|GJien Bien Province|VN|21.39|103.02
Tlaxcala|Tlaxcala|MX|19.32|-98.24
Hawr al 'Anz|Dubai|AE|25.28|55.34
Akhisar|Manisa|TR|38.92|27.84
Danbury|CT|US|41.39|-73.45
Sumenep|East Java|ID|-7.01|113.86
Ushiku|Ibaraki|JP|35.97|140.13
Katunayaka|Western Province|LK|7.17|79.89
Yeongju|Gyeongsangbuk-do|KR|36.82|128.63
Dacheng|Hainan|CN|19.51|109.39
Mianyang|Shaanxi|CN|33.16|106.69
Bijnor|Uttar Pradesh|IN|29.37|78.14
Tanjay|Central Visayas|PH|9.52|123.16
St Albans|England|GB|51.75|-0.33
Fnidek|Tanger-Tetouan-Al Hoceima|MA|35.85|-5.36
Dhoraji|Gujarat|IN|21.73|70.45
East Norwalk|CT|US|41.11|-73.4
Gununo|South Ethiopia Regional State|ET|6.92|37.65
Areka|South Ethiopia Regional State|ET|7.07|37.7
Edinburg|TX|US|26.3|-98.16
Virappanchathiram|Tamil Nadu|IN|11.35|77.71
Sunrise|FL|US|26.13|-80.11
Salina Cruz|Oaxaca|MX|16.18|-95.19
Dundee|KwaZulu-Natal|ZA|-28.17|30.23
Carrao|Sao Paulo|BR|-23.55|-46.54
Wilhelmshaven|Lower Saxony|DE|53.55|8.1
Qus|Qena|EG|25.92|32.76
Nowy Sacz|Lesser Poland|PL|49.62|20.7
Ogaminana|Kogi State|NG|7.59|6.22
Akcapinar|Tunceli|TR|38.95|38.94
Kasserine|Kasserine Governorate|TN|35.17|8.84
Chita|Aichi|JP|35|136.86
Karakol|Issyk-Kul|KG|42.49|78.39
Piet Retief|Mpumalanga|ZA|-27.01|30.81
Mackay|Queensland|AU|-21.15|149.17
Dazhong|Jiangsu|CN|33.2|120.46
Ettadhamen|Ariana Governorate|TN|36.83|10.11
Suceava|Suceava|RO|47.63|26.25
Heroica Zitacuaro|Michoacan|MX|19.44|-100.36
Liaolan|Shandong|CN|36.67|119.88
Balaghat|Madhya Pradesh|IN|21.82|80.19
Trinidad|Beni Department|BO|-14.83|-64.9
Phuthaditjhaba|Free State|ZA|-28.52|28.82
Cerkezkoey|Tekirdag|TR|41.29|28
Jinxiang|Zhejiang|CN|27.43|120.61
Yurga|Kuzbass|RU|55.72|84.89
Timbuktu|Tombouctou|ML|16.77|-3.01
Voskresenka|Kyiv City|UA|50.48|30.6
Hellersdorf|State of Berlin|DE|52.53|13.61
Dongxia|Shandong|CN|36.75|118.58
Saint-Pierre|Reunion|RE|-21.34|55.48
Techiman|Bono East|GH|7.59|-1.94
Bloomington|IN|US|39.17|-86.53
Komendantsky aerodrom|St.-Petersburg|RU|60|30.28
Belo Jardim|Pernambuco|BR|-8.34|-36.42
Kampung Sungai Kajang|Selangor|MY|3.42|101.17
Feni|Chittagong|BD|23.01|91.4
Udhampur|Jammu and Kashmir|IN|32.92|75.14
Wanju|Jeollabuk-do|KR|35.85|127.15
Najibabad|Uttar Pradesh|IN|29.61|78.34
Wako|Saitama|JP|35.79|139.62
Binonga|Western Visayas|PH|10.77|122.98
Reinickendorf|State of Berlin|DE|52.56|13.34
Degan|Chongqing|CN|29.28|106.23
Xiannue|Jiangsu|CN|32.43|119.56
Baghestan|Tehran|IR|35.65|51.13
Ayase|Kanagawa|JP|35.44|139.43
Idaiyarpalaiyam|Tamil Nadu|IN|11.04|76.92
Higashiyamato|Tokyo|JP|35.76|139.45
Cicero|IL|US|41.85|-87.75
Darhan|Darhan Uul|MN|49.49|105.92
Paris 10 Entrepot|Ile-de-France|FR|48.87|2.36
Yinma|Shandong|CN|36.66|119.46
Hemet|CA|US|33.75|-116.97
Chiclana de la Frontera|Andalusia|ES|36.42|-6.14
Cianorte|Parana|BR|-23.66|-52.6
Pinheiro|Maranhao|BR|-2.52|-45.08
Ocotlan|Jalisco|MX|20.35|-102.77
Fredrikstad|Ostfold|NO|59.22|10.93
Sliven|Sliven|BG|42.69|26.33
Jardim Paulista|Sao Paulo|BR|-23.57|-46.66
South Shields|England|GB|55|-1.43
Derry|Northern Ireland|GB|55|-7.31
Hilversum|North Holland|NL|52.22|5.18
Lingdong|Heilongjiang|CN|46.55|131.14
Nanzhang Chengguanzhen|Hubei|CN|31.78|111.83
Hamma Bouziane|Constantine|DZ|36.41|6.6
Al Qanatir al Khayriyah|Qalyubia|EG|30.19|31.14
San Pedro|CA|US|33.74|-118.29
GJong Ngac|Hanoi|VN|21.08|105.77
Ahwatukee Foothills|AZ|US|33.34|-111.98
Paris 10e Arrondissement|Ile-de-France|FR|48.88|2.36
Kisilevsk|Kuzbass|RU|54|86.65
Busto Arsizio|Lombardy|IT|45.61|8.85
Sabratah|Az Zawiyah|LY|32.79|12.49
Yangp'yong|Gyeonggi-do|KR|37.49|127.49
Joao Monlevade|Minas Gerais|BR|-19.81|-43.17
Ungsang|Gyeongsangnam-do|KR|35.41|129.17
Kafr az Zayyat|Gharbia|EG|30.82|30.82
Johns Creek|GA|US|34.03|-84.2
La Piedad de Cabadas|Michoacan|MX|20.34|-102.02
Mission|TX|US|26.22|-98.33
Yamatokoriyama|Nara|JP|34.61|135.77
Troy|MI|US|42.61|-83.15
Sao Bento do Sul|Santa Catarina|BR|-26.25|-49.38
Marilao|Central Luzon|PH|14.76|120.95
Buena Park|CA|US|33.87|-118
Xucheng|Guangdong|CN|20.33|110.17
Ihiala|Anambra|NG|5.85|6.86
Harihar|Karnataka|IN|14.51|75.81
Chilla Soroda Bangar|Delhi|IN|28.6|77.3
Kapiri Mposhi|Central Province|ZM|-13.97|28.67
Carpina|Pernambuco|BR|-7.85|-35.25
Fort Abbas|Punjab|PK|29.19|72.86
Sirsilla|Telangana|IN|18.39|78.81
Moju|Para|BR|-1.88|-48.77
Ceuta|Ceuta|ES|35.89|-5.32
Sinwon-up|South Hwanghae|KP|38.24|125.76
Pori|Satakunta|FI|61.48|21.79
Owariasahi|Aichi|JP|35.21|137.03
Margahayukencana|West Java|ID|-6.97|107.57
Wensu|Xinjiang|CN|41.28|80.24
Al Kharjah|New Valley|EG|25.45|30.55
Al-Kharijah|New Valley|EG|25.25|30.55
Bulacan|Central Luzon|PH|14.79|120.88
San Jose de Guanipa|Anzoategui|VE|8.89|-64.17
Picos|Piaui|BR|-7.08|-41.47
Amakusa|Kumamoto|JP|32.46|130.19
Echizen|Fukui|JP|35.89|136.17
Kimitsu|Chiba|JP|35.35|139.87
Galesong|South Sulawesi|ID|-5.32|119.37
Bambari|Ouaka|CF|5.77|20.68
Mar del Tuyu|Buenos Aires|AR|-36.57|-56.69
San Fernando|Ilocos|PH|16.62|120.32
Kamigyo-ku|Kyoto|JP|35.03|135.76
Mid-City|CA|US|34.04|-118.36
Hawsh 'Isa|Beheira|EG|30.91|30.29
Ningyang|Shandong|CN|35.76|116.79
Bingerville|Abidjan Autonomous District|CI|5.36|-3.89
Lodwar|Turkana County|KE|3.12|35.6
Karauli|Rajasthan|IN|26.5|77.03
Mansa|Punjab|IN|29.99|75.4
Uccle|Brussels Capital|BE|50.8|4.34
Presov|Presov Region|SK|49|21.24
David|Chiriqui Province|PA|8.43|-82.43
Jinshi|Hunan|CN|29.6|111.87
Weston-super-Mare|England|GB|51.35|-2.98
Palm Coast|FL|US|29.58|-81.21
Botafogo|Rio de Janeiro|BR|-22.95|-43.18
Minden|North Rhine-Westphalia|DE|52.29|8.91
Charlesbourg|Quebec|CA|46.9|-71.31
Montego Bay|Saint James Parish|JM|18.47|-77.92
Kraljevo|Central Serbia|RS|43.73|20.69
Norderstedt|Schleswig-Holstein|DE|53.7|9.99
Fayetteville|AR|US|36.06|-94.16
Sioux City|IA|US|42.5|-96.4
Yacuiba|Tarija Department|BO|-22.02|-63.68
Pontevedra|Galicia|ES|42.43|-8.64
Muhanga|Southern Province|RW|-2.02|29.71
Shirvan|North Khorasan|IR|37.4|57.93
Marj Al Hamam|Amman|JO|31.9|35.85
Sobradinho II|Federal District|BR|-15.63|-47.83
Ochota|Mazovia|PL|52.22|20.99
Havirov|Moravian-Silesian Region|CZ|49.78|18.44
La Villa del Rosario|Zulia|VE|10.33|-72.31
Shikokuchuo|Ehime|JP|33.98|133.55
Atlantis|Western Cape|ZA|-33.57|18.48
Aoxi|Jiangxi|CN|27.43|115.84
Liping|Guizhou|CN|26.23|109.13
Pau|New Aquitaine|FR|43.31|-0.36
Rutshuru|North Kivu|CD|-1.19|29.45
Kelo|Tandjile|TD|9.31|15.81
An Hai|Da Nang City|VN|16.07|108.23
Sidi Kacem|Rabat-Sale-Kenitra|MA|34.22|-5.71
Algorta|Basque Country|ES|43.35|-3.01
Halifax|England|GB|53.72|-1.85
Torrevieja|Valencia|ES|37.98|-0.68
Changqing|Shandong|CN|36.56|116.73
Jacobina|Bahia|BR|-11.18|-40.51
Malapatan|Soccsksargen|PH|5.97|125.29
Lyon 07|Auvergne-Rhone-Alpes|FR|45.75|4.84
Cruzeiro|Sao Paulo|BR|-22.57|-44.97
Dali Old Town|Yunnan|CN|25.69|100.16
Sinhyeon|Gyeongsangnam-do|KR|34.88|128.63
Xindian|Shandong|CN|36.8|118.29
San Martin|Mendoza|AR|-33.08|-68.47
Saint-Hubert|Quebec|CA|45.5|-73.42
Jangipur|West Bengal|IN|24.47|88.08
Ecunna|Huambo|AO|-12.68|15.51
Mus|Mus|TR|38.73|41.48
Douar Hicher|Manouba|TN|36.83|10.09
Anzhero-Sudzhensk|Kuzbass|RU|56.08|86.02
Sahand|East Azerbaijan|IR|37.95|46.11
Lake Forest|CA|US|33.65|-117.69
Arcoverde|Pernambuco|BR|-8.42|-37.05
Pernik|Pernik|BG|42.6|23.03
Qiaoguan|Shandong|CN|36.56|118.88
Manono|Tanganyika|CD|-7.3|27.4
Merced|CA|US|37.3|-120.48
Minyat an Nasr|Dakahlia|EG|31.13|31.64
Sant Boi de Llobregat|Catalonia|ES|41.34|2.04
Pozuelo de Alarcon|Madrid|ES|40.43|-3.81
Bagamoyo|Pwani|TZ|-6.44|38.9
Cukai|Terengganu|MY|4.25|103.42
Parit Sulung|Johor|MY|1.98|102.88
Nangong|Hebei|CN|37.35|115.39
Mbalmayo|Centre|CM|3.52|11.5
Sabaneta|Antioquia|CO|6.15|-75.62
Limao|Sao Paulo|BR|-23.49|-46.67
Lueshun|Liaoning|CN|38.8|121.27
Troitsk|Chelyabinsk|RU|54.09|61.57
Madaba|Madaba|JO|31.72|35.79
Matay|Minya|EG|28.42|30.78
Hengelo|Overijssel|NL|52.27|6.79
Reef Al Fujairah City|Fujairah|AE|25.14|56.25
Nizip|Gaziantep|TR|37.01|37.79
Nakhon Sawan|Nakhon Sawan|TH|15.7|100.14
Colombes|Ile-de-France|FR|48.92|2.25
Laksham|Chittagong|BD|23.24|91.12
Longview|TX|US|32.5|-94.74
Les Corts|Catalonia|ES|41.39|2.13
Gobindgarh|Punjab|IN|30.67|76.3
Dondo|Sofala|MZ|-19.61|34.74
Maple Ridge|British Columbia|CA|49.22|-122.6
Caldas|Antioquia|CO|6.09|-75.64
Omihachiman|Shiga|JP|35.13|136.1
Budapest VIII. keruelet|Budapest|HU|47.49|19.07
Atambua|East Nusa Tenggara|ID|-9.11|124.89
Anguo|Jiangsu|CN|34.83|116.82
Quixeramobim|Ceara|BR|-5.2|-39.29
Fatsa|Ordu|TR|41.03|37.5
Tres Rios|Rio de Janeiro|BR|-22.12|-43.21
Azov|Rostov|RU|47.11|39.41
Pagbilao|Calabarzon|PH|13.97|121.7
Bryan|TX|US|30.67|-96.37
Ipoti|Ekiti State|NG|7.87|5.08
Tanashicho|Tokyo|JP|35.73|139.54
Shiwan|Guangdong|CN|23|113.08
Edmonton|England|GB|51.63|-0.06
Westland|MI|US|42.32|-83.4
Ishwardi|Rajshahi Division|BD|24.13|89.07
Tamworth|England|GB|52.63|-1.7
Limay|Central Luzon|PH|14.56|120.6
Bolgatanga|Upper East|GH|10.79|-0.85
Donghe|Sichuan|CN|32.23|106.3
Gosport|England|GB|50.8|-1.13
La Dorada|Caldas Department|CO|5.45|-74.66
Le Tampon|Reunion|RE|-21.28|55.52
Ratodero|Sindh|PK|27.8|68.29
Saunda|Jharkhand|IN|23.66|85.33
Akiruno|Tokyo|JP|35.73|139.23
Brena|Lima region|PE|-12.06|-77.05
Moema|Sao Paulo|BR|-23.6|-46.66
Presidencia Roque Saenz Pena|Chaco|AR|-26.79|-60.44
Maraimalainagar|Tamil Nadu|IN|12.8|80.03
Huaiyang|Hebei|CN|37.76|114.52
Coslada|Madrid|ES|40.42|-3.56
Ashoknagar|Madhya Pradesh|IN|24.58|77.73
Sesto San Giovanni|Lombardy|IT|45.53|9.23
Macaiba|Rio Grande do Norte|BR|-5.86|-35.35
Gwangju|Gyeonggi-do|KR|37.41|127.26
Agboville|Lagunes District|CI|5.93|-4.21
Villingen-Schwenningen|Baden-Wurttemberg|DE|48.06|8.49
Tamanghasset|Tamanrasset|DZ|22.79|5.52
Kaspiysk|Dagestan|RU|42.88|47.64
Lucca|Tuscany|IT|43.84|10.5
Babamba|Tshopo|CD|0.18|27.48
Phulwari Sharif|Bihar|IN|25.58|85.07
Tangping|Guangdong|CN|22.03|111.94
Ar Rass|Al-Qassim Region|SA|25.87|43.5
Mhow|Madhya Pradesh|IN|22.56|75.77
Warwick|RI|US|41.7|-71.42
Bartin|Bartin|TR|41.64|32.34
Luzern|Lucerne|CH|47.05|8.31
Barka'|Al Batinah South|OM|23.68|57.89
Al Khankah|Qalyubia|EG|30.21|31.37
Kasongo|Maniema|CD|-4.43|26.67
Lakewood|CA|US|33.85|-118.13
Guider|North|CM|9.93|13.95
Salmas|West Azerbaijan|IR|38.2|44.77
Yirga 'Alem|Sidama Region|ET|6.75|38.42
An Khe|Gia Lai|VN|13.95|108.65
Naqadeh|West Azerbaijan|IR|36.96|45.39
Sao Sebastiao|Sao Paulo|BR|-23.76|-45.41
Bur Fu'ad|Port Said|EG|31.24|32.32
Timoteo|Minas Gerais|BR|-19.58|-42.65
Scunthorpe|England|GB|53.58|-0.65
Tiznit|Souss-Massa|MA|29.7|-9.73
Muntilan|Central Java|ID|-7.58|110.29
Paysandu|Paysandu Department|UY|-32.32|-58.08
Uman|Cherkasy|UA|48.75|30.22
Pacatuba|Ceara|BR|-3.98|-38.62
Yan Nawa|Bangkok|TH|13.7|100.54
Remedios de Escalada de San Martin|Buenos Aires|AR|-34.73|-58.4
Beauport|Quebec|CA|46.86|-71.19
Yudong|Chongqing|CN|29.39|106.52
Malout|Punjab|IN|30.21|74.48
Kadi|Gujarat|IN|23.3|72.33
Bulungu|Kwilu|CD|-4.54|18.6
Balqash|Karaganda|KZ|46.85|74.98
Guaynabo|Guaynabo|PR|18.36|-66.11
Farmington Hills|MI|US|42.49|-83.38
Sarishabari|Mymensingh Division|BD|24.75|89.83
Fatehjang|Punjab|PK|33.56|72.64
San Tan Valley|AZ|US|33.19|-111.53
Mount Pleasant|SC|US|32.79|-79.86
Athi River|Machakos County|KE|-1.46|36.98
Lagoa Santa|Minas Gerais|BR|-19.63|-43.9
Lambayong|Soccsksargen|PH|6.52|125.04
Konstanz|Baden-Wurttemberg|DE|47.66|9.18
Tatebayashi|Gunma|JP|36.25|139.53
Mweka|Kasai|CD|-4.85|21.56
Konin|Greater Poland|PL|52.22|18.25
Nangen|Jeollabuk-do|KR|35.41|127.39
Changning|Sichuan|CN|28.58|104.92
Vijalpor|Gujarat|IN|20.92|72.91
Pozzuoli|Campania|IT|40.84|14.1
Resita|Caras-Severin County|RO|45.3|21.89
Zilina|Zilina Region|SK|49.22|18.74
Palakollu|Andhra Pradesh|IN|16.52|81.73
Kabalo|Tanganyika|CD|-6.05|26.91
Baudhuinville|Tanganyika|CD|-7.08|29.74
Sokcho|Gangwon-do|KR|38.21|128.59
Xiugu|Jiangxi|CN|27.91|116.78
Himatnagar|Gujarat|IN|23.6|72.97
Lalupon|Oyo State|NG|7.47|4.07
Pilar|Buenos Aires|AR|-34.46|-58.91
Al Hurshah|Az Zawiyah|LY|32.76|12.67
Worms|Rheinland-Pfalz|DE|49.63|8.36
Cranston|RI|US|41.78|-71.44
Ozersk|Chelyabinsk|RU|55.76|60.7
Tallaght|Leinster|IE|53.29|-6.37
Rockhampton|Queensland|AU|-23.38|150.51
Moabit|State of Berlin|DE|52.53|13.34
San Timoteo|Zulia|VE|9.79|-71.07
Yessentuki|Stavropol Kray|RU|44.05|42.86
Sao Miguel|Sao Paulo|BR|-23.49|-46.43
Vitry-sur-Seine|Ile-de-France|FR|48.79|2.4
Largo|FL|US|27.91|-82.79
Naeso|Gyeongsangnam-do|KR|35.25|128.52
Santa Cecilia|Sao Paulo|BR|-23.53|-46.65
Diyarb Najm|Sharqia|EG|30.75|31.44
Dholka|Gujarat|IN|22.73|72.44
Mooca|Sao Paulo|BR|-23.56|-46.6
Aveiro|Aveiro|PT|40.65|-8.65
Ravenna|Emilia-Romagna|IT|44.41|12.2
Shanting|Shandong|CN|35.08|117.46
Rouissat|Ouargla|DZ|31.92|5.35
Madido|Lusaka Province|ZM|-15.35|28.37
Klin|Moscow Oblast|RU|56.33|36.73
Getxo|Basque Country|ES|43.36|-3.01
Buta|Bas-Uele|CD|2.79|24.73
Kotkapura|Punjab|IN|30.58|74.83
East Hastings|British Columbia|CA|49.27|-123.06
Fiumicino|Lazio|IT|41.77|12.24
Homestead|FL|US|25.47|-80.48
Junlian|Sichuan|CN|28.17|104.51
Lecce|Apulia|IT|40.35|18.17
South Suffolk|VA|US|36.72|-76.59
Avondale|AZ|US|33.44|-112.35
Atakpame|Plateaux|TG|7.53|1.13
Berestovskyi|Donetsk|UA|48.04|37.88
Curvelo|Minas Gerais|BR|-18.76|-44.43
Lai Vung|Dong Thap|VN|10.26|105.59
Mijas|Andalusia|ES|36.6|-4.64
Gueiguee|Carabobo|VE|10.08|-67.78
Bargarh|Odisha|IN|21.33|83.62
Nianzhuang|Jiangsu|CN|34.3|117.77
Aulnay-sous-Bois|Ile-de-France|FR|48.94|2.49
Kharghar|Maharashtra|IN|19.05|73.07
Tepeji del Rio de Ocampo|Hidalgo|MX|19.91|-99.34
Kotari|Kyoto|JP|34.92|135.71
Chatham|England|GB|51.38|0.53
Varese|Lombardy|IT|45.82|8.83
Tustin|CA|US|33.75|-117.83
Santa Catarina Pinula|Guatemala|GT|14.57|-90.5
Bustos|Central Luzon|PH|14.96|120.92
Sama'il|Ad Dakhiliyah|OM|23.3|57.95
Casa Verde|Sao Paulo|BR|-23.5|-46.66
Khemis Miliana|Ain Defla|DZ|36.26|2.22
Ambalantota|Southern Province|LK|6.12|81.02
Bakhmut|Donetsk|UA|48.59|38
Bani Yas City|Abu Dhabi|AE|24.31|54.63
Agua Rasa|Minas Gerais|BR|-20.43|-45.17
Yingjiang|Yunnan|CN|24.71|97.94
Elbistan|Kahramanmaras|TR|38.21|37.2
Kondoa|Dodoma|TZ|-4.9|35.78
Serrinha|Bahia|BR|-11.66|-39.01
Mountain View|CA|US|37.39|-122.08
Napa|CA|US|38.3|-122.29
Kairana|Uttar Pradesh|IN|29.4|77.21
Brajarajnagar|Odisha|IN|21.82|83.92
Hanno|Saitama|JP|35.85|139.32
Loushanguan|Guizhou|CN|28.14|106.82
Somerville|MA|US|42.39|-71.1
Kamareddi|Telangana|IN|18.32|78.34
Baoying|Jiangsu|CN|33.23|119.31
Giugliano in Campania|Campania|IT|40.93|14.2
Kedungwaru|East Java|ID|-8.07|111.92
Kendall|FL|US|25.68|-80.32
Lawrence|MA|US|42.71|-71.16
Dashiqiao|Liaoning|CN|40.64|122.5
Budapest XV. keruelet|Budapest|HU|47.56|19.12
Panshi|Jilin|CN|42.94|126.06
Palwancha|Telangana|IN|17.58|80.68
Neumuenster|Schleswig-Holstein|DE|54.07|9.98
Chapadinha|Maranhao|BR|-3.74|-43.36
Serpong|West Java|ID|-6.32|106.66
Meru|Meru County|KE|0.05|37.66
Piotrkow Trybunalski|Lodz Voivodeship|PL|51.41|19.7
Purmerend|North Holland|NL|52.51|4.96
Qunghirot|Karakalpakstan|UZ|43.04|58.84
Alahabad|Punjab|PK|30.88|74.06
Nyeri|Nyeri County|KE|-0.42|36.95
Cachoeira do Sul|Rio Grande do Sul|BR|-30.04|-52.89
Xichang|Guangxi|CN|21.63|108.95
Gamagori|Aichi|JP|34.83|137.23
Manmad|Maharashtra|IN|20.25|74.44
Srikalahasti|Andhra Pradesh|IN|13.76|79.7
Huanglou|Shandong|CN|36.65|118.61
Dushan|Guizhou|CN|25.83|107.53
Kanyama|Haut-Lomami|CD|-7.52|24.17
Vorkuta|Komi|RU|67.51|64.07
Sangmelima|South|CM|2.93|11.98
Tres Coracoes|Minas Gerais|BR|-21.7|-45.25
El Cafetal|Miranda|VE|10.47|-66.83
Rikaze|Tibet|CN|29.25|88.88
Sha Tin Wai|Sha Tin|HK|22.38|114.2
Hajiawa|Sulaymaniyah|IQ|36.24|44.79
Khewra|Punjab|PK|32.65|73.01
Fili|Moscow|RU|55.75|37.49
Cung Kiem|Bac Ninh|VN|21.19|106.16
Ughelli|Delta|NG|5.49|6
Dorsten|North Rhine-Westphalia|DE|51.66|6.97
Stockton-on-Tees|England|GB|54.57|-1.32
Tan-Tan|Guelmim-Oued Noun|MA|28.44|-11.1
Parma|OH|US|41.4|-81.72
Miabi|East Kasai|CD|-6.22|23.39
Drobeta-Turnu Severin|Mehedinti County|RO|44.63|22.65
New Rochelle|NY|US|40.91|-73.78
San Jose Pinula|Guatemala|GT|14.55|-90.41
Paco|National Capital Region|PH|14.59|120.99
Kottagudem|Telangana|IN|17.55|80.62
Lynchburg|VA|US|37.41|-79.14
Lelystad|Flevoland|NL|52.51|5.47
Medford|OR|US|42.33|-122.88
Telemaco Borba|Parana|BR|-24.32|-50.62
Zrenjanin|Vojvodina|RS|45.38|20.38
Deerfield Beach|FL|US|26.32|-80.1
Songlou|Jiangsu|CN|34.57|116.6
Pongch'on-up|South Hwanghae|KP|38.12|126.2
Bella Vista|Buenos Aires|AR|-34.57|-58.69
San Francisco|Caraga|PH|8.54|125.95
Lerdo|Durango|MX|25.54|-103.52
Taixing|Jiangsu|CN|32.17|120.01
Genteng|East Java|ID|-8.37|114.15
Kidapawan|Soccsksargen|PH|7.01|125.09
Bolenge|Equateur|CD|0|18.22
Amstelveen|North Holland|NL|52.3|4.86
Sathorn|Bangkok|TH|13.75|100.52
Bende|Abia State|NG|5.56|7.63
Sylmar|CA|US|34.31|-118.45
Kropotkin|Krasnodar Krai|RU|45.44|40.57
Calarca|Quindio Department|CO|4.53|-75.64
Oke Mesi|Osun State|NG|7.82|4.92
Kimpese|Bas-Congo|CD|-5.56|14.43
Khrustalnyi|Luhansk|UA|48.14|38.92
Kafanchan|Kaduna State|NG|9.58|8.29
Edfu|Aswan|EG|24.98|32.88
Pleasanton|CA|US|37.66|-121.87
Saint-Leonard|Quebec|CA|45.59|-73.6
Tangjiazhuang|Hebei|CN|39.74|118.45
Sao Roque|Sao Paulo|BR|-23.53|-47.14
Shadrinsk|Kurgan Oblast|RU|56.09|63.64
Willowdale|Ontario|CA|43.77|-79.4
Talagang|Punjab|PK|32.93|72.42
Huehuetenango|Huehuetenango|GT|15.32|-91.47
Senhor do Bonfim|Bahia|BR|-10.46|-40.19
Dosso|Dosso Region|NE|13.05|3.19
Bang Sue subdistrict|Bangkok|TH|13.81|100.53
Luedenscheid|North Rhine-Westphalia|DE|51.22|7.63
Zarzis|Medenine Governorate|TN|33.5|11.11
Cacador|Santa Catarina|BR|-26.78|-51.02
Phuket|Phuket|TH|7.89|98.4
Kahna Nau|Punjab|PK|31.37|74.37
Polotsk|Vitebsk|BY|55.49|28.79
Tefe|Amazonas|BR|-3.37|-64.72
Nong Prue|Kanchanaburi|TH|14.61|99.46
Sant Cugat del Valles|Catalonia|ES|41.47|2.09
Nawabganj|Uttar Pradesh|IN|26.93|81.2
Gedangan|East Java|ID|-7.39|112.73
Cyberjaya|Selangor|MY|2.92|101.66
Yanta|Shandong|CN|36.24|115.67
Belmont Cragin|IL|US|41.93|-87.77
Bwizibwera|Western Region|UG|-0.59|30.63
Brooklyn Park|MN|US|45.09|-93.36
Gueckedou|Nzerekore Region|GN|8.57|-10.13
Gokak|Karnataka|IN|16.17|74.82
Ceara-Mirim|Rio Grande do Norte|BR|-5.63|-35.43
Mamou|Mamou Region|GN|10.38|-12.09
Zhuangyuan|Shandong|CN|37.31|120.83
Tikamgarh|Madhya Pradesh|IN|24.74|78.83
Ikom|Cross River State|NG|5.97|8.71
Arakkonam|Tamil Nadu|IN|13.08|79.67
Wuyang|Anhui|CN|31.99|116.25
Kashihara|Osaka|JP|34.58|135.62
Xiongzhou|Guangdong|CN|25.12|114.3
Chaigou|Shandong|CN|36.25|119.62
Bumahen|Tehran|IR|35.73|51.87
Matao|Sao Paulo|BR|-21.6|-48.37
Ponorogo|East Java|ID|-7.87|111.46
Araria|Bihar|IN|26.15|87.51
Agulu|Anambra|NG|6.1|7.06
Netrakona|Mymensingh Division|BD|24.88|90.73
Goodyear|AZ|US|33.44|-112.36
Kaambooni|Lower Juba|SO|-1.64|41.59
Alfenas|Minas Gerais|BR|-21.43|-45.95
Catanzaro|Calabria|IT|38.88|16.6
Prince George|British Columbia|CA|53.92|-122.75
Mossel Bay|Western Cape|ZA|-34.18|22.15
Nakatsugawa|Gifu|JP|35.48|137.5
New Westminster|British Columbia|CA|49.21|-122.91
Kennewick|WA|US|46.21|-119.14
Marburg an der Lahn|Hesse|DE|50.81|8.77
Russas|Ceara|BR|-4.94|-37.98
Bistrita|Bistrita-Nasaud County|RO|47.13|24.5
Marseille 08|Provence-Alpes-Cote d'Azur|FR|43.27|5.38
Cam Le|Da Nang City|VN|16.02|108.2
Xinzhou|Hubei|CN|30.87|114.8
Shitanjing|Ningxia|CN|39.23|106.34
Coffs Harbour|New South Wales|AU|-30.3|153.11
Chiang Rai|Chiang Rai|TH|19.91|99.83
Deurne|Flanders|BE|51.22|4.47
Sagaing|Sagaing Region|MM|21.88|95.98
Koch Bihar|West Bengal|IN|26.33|89.45
Mooka|Tochigi|JP|36.43|140.02
Tumen|Jilin|CN|42.97|129.84
Natori-shi|Miyagi|JP|38.17|140.88
Aviles|Asturias|ES|43.55|-5.92
Armant|Qena|EG|25.62|32.54
Kharakvasla|Maharashtra|IN|18.44|73.78
Gualeguaychu|Entre Rios|AR|-33.01|-58.52
Thanhlyin|Yangon|MM|16.78|96.25
Isiolo|Isiolo County|KE|0.35|37.58
Vyborg|Leningradskaya Oblast'|RU|60.71|28.75
Alameda|CA|US|37.77|-122.26
Palencia|Castille and Leon|ES|42.01|-4.52
Curepipe|Plaines Wilhems|MU|-20.32|57.53
Danane|Montagnes|CI|7.26|-8.15
Arona|Canary Islands|ES|28.1|-16.68
Waliso|Oromiya|ET|8.53|37.97
Tupi|Soccsksargen|PH|6.33|124.95
Qinggang|Chongqing|CN|29.47|106.24
Hengbei|Guangdong|CN|23.88|115.73
Honjo|Saitama|JP|36.24|139.19
Bhadohi|Uttar Pradesh|IN|25.4|82.57
Torrent|Valencia|ES|39.44|-0.47
Circoiscrizione I|Piedmont|IT|45.07|7.69
Lins|Sao Paulo|BR|-21.68|-49.74
Carlisle|England|GB|54.9|-2.94
Town 'n' Country|FL|US|28.01|-82.58
Bellflower|CA|US|33.88|-118.12
Kobanya|Budapest|HU|47.48|19.14
Yishan|Shandong|CN|36.22|118.7
Katoya|West Bengal|IN|23.65|88.13
Youhao|Heilongjiang|CN|47.85|128.84
Joensuu|North Karelia|FI|62.6|29.76
Medininagar|Jharkhand|IN|24.04|84.07
Washim|Maharashtra|IN|20.11|77.13
Reutov|Moscow Oblast|RU|55.76|37.86
Bagbera|Jharkhand|IN|22.76|86.19
Savarkundla|Gujarat|IN|21.34|71.3
Bandar-e Emam Khomeyni|Khuzestan|IR|30.44|49.1
Toyooka|Hyogo|JP|35.54|134.82
Putatan|Sabah|MY|5.93|116.06
Chino Hills|CA|US|33.99|-117.76
Bang Kruai|Nonthaburi|TH|13.8|100.47
Denov|Surxondaryo Region|UZ|38.27|67.9
Bloomington|IL|US|40.48|-88.99
Basoda|Madhya Pradesh|IN|23.85|77.94
Santa Cruz del Quiche|Quiche|GT|15.03|-91.15
Daura|Yobe State|NG|11.55|11.41
Al Hayy|Wasit|IQ|32.17|46.04
Bamban|Central Luzon|PH|15.27|120.57
Pingyi|Shandong|CN|35.5|117.63
Southall|England|GB|51.51|-0.37
Budapest XVII. keruelet|Budapest|HU|47.48|19.25
Wulong|Chongqing|CN|29.32|107.76
Valvedditturai|Northern Province|LK|9.82|80.17
Rheinhausen|North Rhine-Westphalia|DE|51.4|6.71
Goma|North Kivu|CD|-1.67|29.23
Linping|Zhejiang|CN|30.42|120.3
Huai Khwang|Bangkok|TH|13.78|100.58
Sirs al Layyanah|Monufia|EG|30.44|30.97
Ilioupoli|Attica|GR|37.93|23.77
San Juan|Loreto|PE|-3.78|-73.28
Zahle|Bekaa|LB|33.85|35.9
Daet|Bicol Region|PH|14.11|122.96
Daugavpils|Daugavpils|LV|55.88|26.53
Blue Mountains|New South Wales|AU|-33.71|150.33
Rugby|England|GB|52.37|-1.26
Kashiba|Nara|JP|34.53|135.71
Alafaya|FL|US|28.56|-81.21
Wa|Upper West|GH|10.06|-2.5
Vanadzor|Lori|AM|40.81|44.5
Kouvola|Kymenlaakso|FI|60.87|26.7
Donggongon|Sabah|MY|5.91|116.1
Szombathely|Vas County|HU|47.23|16.62
Xixiang|Guangdong|CN|22.59|113.89
Matala|Huila|AO|-14.73|15.03
Colon|Colon|PA|9.36|-79.9
Alekseyevka|Moscow Oblast|RU|55.63|37.8
Kuacjok|Warrap|SS|8.3|27.98
Tanuku|Andhra Pradesh|IN|16.75|81.68
Gurdaspur|Punjab|IN|32.04|75.4
Castrop-Rauxel|North Rhine-Westphalia|DE|51.56|7.31
Marsala|Sicily|IT|37.8|12.44
Ouro Preto|Minas Gerais|BR|-20.39|-43.51
Kizugawa|Kyoto|JP|34.74|135.84
Pakse|Champasak Province|LA|15.12|105.8
Tome|Miyagi|JP|38.71|141.16
Springdale|AR|US|36.19|-94.13
Lulea|Norrbotten|SE|65.58|22.15
Edattala|Kerala|IN|10.06|76.38
Shap Pat Heung|Yuen Long|HK|22.42|114.04
Marseille 15|Provence-Alpes-Cote d'Azur|FR|43.37|5.35
Jardim Botanico|Federal District|BR|-15.87|-47.81
Huankou|Jiangsu|CN|34.87|116.67
Ciranjang-hilir|West Java|ID|-6.82|107.26
Linkou|Heilongjiang|CN|45.28|130.27
Nchelenge|Luapula Province|ZM|-9.35|28.73
Racine|WI|US|42.73|-87.78
Ipiales|Narino|CO|0.83|-77.64
Roosendaal|North Brabant|NL|51.53|4.47
Hakkari|Hakkari|TR|37.57|43.74
Ukunda|Kwale County|KE|-4.29|39.56
Bauang|Ilocos|PH|16.53|120.33
Nikko|Tochigi|JP|36.75|139.62
Jaboticabal|Sao Paulo|BR|-21.25|-48.32
Hasselt|Flanders|BE|50.93|5.34
Keningau|Sabah|MY|5.34|116.16
Gateshead|England|GB|54.96|-1.6
Huangmei|Hubei|CN|30.19|116.02
Campo Limpo Paulista|Sao Paulo|BR|-23.21|-46.78
Numan|Adamawa|NG|9.46|12.03
Hammond|IN|US|41.58|-87.5
Itay al Barud|Beheira|EG|30.89|30.67
Milpitas|CA|US|37.43|-121.91
Ouarzazate|Draa-Tafilalet|MA|30.92|-6.89
Inowroclaw|Kujawsko-Pomorskie|PL|52.8|18.26
UEnye|Ordu|TR|41.14|37.29
Bodhan|Telangana|IN|18.66|77.89
Santo Angelo|Rio Grande do Sul|BR|-28.3|-54.26
Songling|Jiangsu|CN|31.19|120.72
Bogenhausen|Bavaria|DE|48.15|11.62
Jishui|Henan|CN|33.73|115.4
Aalst|Flanders|BE|50.94|4.04
Lubin|Lower Silesia|PL|51.4|16.2
Mechelen|Flanders|BE|51.03|4.48
Santa Rosa|Rio Grande do Sul|BR|-27.87|-54.48
Lisburn|Northern Ireland|GB|54.52|-6.04
Welk'it'e|Central Ethiopia Regional State|ET|8.28|37.78
Bagong Barrio|National Capital Region|PH|14.67|120.99
Kambar|Sindh|PK|27.59|68
Barracas|Buenos Aires F.D.|AR|-34.65|-58.38
Nazareth|Northern District|IL|32.7|35.3
Mazatenango|Suchitepeque|GT|14.53|-91.5
Khomeyn|Markazi|IR|33.64|50.08
Shulan|Jilin|CN|44.41|126.95
Balrampur|Uttar Pradesh|IN|27.43|82.19
Tsubame|Niigata|JP|37.66|138.93
Mandela|Greater Accra|GH|5.55|-0.34
Suva|Central|FJ|-18.14|178.43
Jelenia Gora|Lower Silesia|PL|50.9|15.73
Matehuala|San Luis Potosi|MX|23.65|-100.64
Gebiley|Woqooyi Galbeed|SO|9.7|43.62
Quatre Bornes|Plaines Wilhems|MU|-20.26|57.48
Fukuchiyama|Kyoto|JP|35.3|135.12
Mungyeong|Gyeongsangbuk-do|KR|36.59|128.2
Baramula|Jammu and Kashmir|IN|34.21|74.34
Paisley|Scotland|GB|55.83|-4.43
KeurMedoune|Diourbel Region|SN|14.76|-15.9
Agua Prieta|Sonora|MX|31.32|-109.54
Caninde|Ceara|BR|-4.36|-39.31
Pesaro|The Marches|IT|43.91|12.92
Kanasin|Yucatan|MX|20.93|-89.56
Cozumel|Quintana Roo|MX|20.5|-86.94
Baicheng|Shandong|CN|36.33|119.78
Lod|Central District|IL|31.95|34.89
Wawer|Mazovia|PL|52.2|21.18
As Suwayrah|Wasit|IQ|32.93|44.78
Akihabara|Tokyo|JP|35.7|139.77
Siedlce|Mazovia|PL|52.17|22.29
Damiao|Jiangsu|CN|34.26|117.36
South Surrey|British Columbia|CA|49.05|-122.79
Santa Cruz de Barahona|Barahona Province|DO|18.21|-71.1
Gary|IN|US|41.59|-87.35
Shush|Khuzestan|IR|32.19|48.24
Putney|England|GB|51.46|-0.22
Karwar|Karnataka|IN|14.81|74.13
Ovalle|Coquimbo Region|CL|-30.6|-71.2
Kunitachi|Tokyo|JP|35.68|139.44
Scranton|PA|US|41.41|-75.66
Surman|Az Zawiyah|LY|32.76|12.57
Mafikeng|North West|ZA|-25.87|25.64
Coyah|Kindia|GN|9.71|-13.38
Pok Fu Lam|Southern District|HK|22.27|114.13
Voskresensk|Moscow Oblast|RU|55.31|38.69
Keratsini|Attica|GR|37.96|23.62
Baldwin Park|CA|US|34.09|-117.96
Dhulian|West Bengal|IN|24.68|87.95
Yen Hoa|Hanoi|VN|21.02|105.79
Hunchun|Jilin|CN|42.87|130.36
Nabari|Mie|JP|34.62|136.08
Kagoro|Kaduna State|NG|9.61|8.39
Auburn|WA|US|47.31|-122.23
Rabkavi-Banhatti|Karnataka|IN|16.47|75.12
Yalta|Crimea|UA|44.5|34.17
Dubai Festival City|Dubai|AE|25.22|55.36
Les Rivieres|Quebec|CA|46.82|-71.27
Hassi Bahbah|Djelfa|DZ|35.07|3.03
Zahir Pir|Punjab|PK|28.81|70.52
Mawana|Uttar Pradesh|IN|29.1|77.92
Tsurusaki|Oita|JP|33.25|131.69
Jozsefvaros|Budapest|HU|47.49|19.07
Khlong Chan|Bangkok|TH|13.78|100.65
Sarqant|Zhetysu Region|KZ|45.41|79.92
Shirpur|Maharashtra|IN|21.35|74.88
Kiserian|Kajiado County|KE|-1.43|36.69
Pirassununga|Sao Paulo|BR|-22|-47.43
Valenca|Rio de Janeiro|BR|-22.25|-43.7
Marseille 09|Provence-Alpes-Cote d'Azur|FR|43.25|5.41
Puerto Padre|Las Tunas Province|CU|21.2|-76.6
Budge Budge|West Bengal|IN|22.48|88.18
Arraijan|Panama Oeste Province|PA|8.94|-79.64
La Rochelle|New Aquitaine|FR|46.16|-1.15
Kundla|Gujarat|IN|21.34|71.31
Itapetinga|Bahia|BR|-15.25|-40.25
Fishers|IN|US|39.96|-86.01
Shrewsbury|England|GB|52.71|-2.75
Saint Joseph|MO|US|39.77|-94.85
Al Matar al 'Atiq|Baladiyat ad Dawhah|QA|25.25|51.56
Sandu|Hainan|CN|19.79|109.22
Mmabatho|North West|ZA|-25.85|25.63
Visnagar|Gujarat|IN|23.7|72.55
Liangxiang|Beijing|CN|39.74|116.13
Champigny-sur-Marne|Ile-de-France|FR|48.82|2.49
Melong|Littoral|CM|5.12|9.96
Brookes Point|Mimaropa|PH|8.77|117.84
Kannauj|Uttar Pradesh|IN|27.06|79.92
Zhaodun|Jiangsu|CN|34.3|117.86
Luxembourg|Luxembourg|LU|49.61|6.13
Yenakiyeve|Donetsk|UA|48.24|38.2
La Louviere|Wallonia|BE|50.49|4.19
Giang Vo|Hanoi|VN|21.03|105.81
Pancevo|Vojvodina|RS|44.87|20.64
Fenghua|Zhejiang|CN|29.66|121.41
Khajoori Khas|Delhi|IN|28.71|77.26
Rueil-Malmaison|Ile-de-France|FR|48.88|2.19
Neelankarai|Tamil Nadu|IN|12.95|80.26
Nagina|Uttar Pradesh|IN|29.44|78.44
Caledon|Ontario|CA|43.87|-79.99
Juhaynah|Sohag|EG|26.67|31.5
Biruaca|Apure|VE|7.84|-67.52
Vinhedo|Sao Paulo|BR|-23.03|-46.98
Pharr|TX|US|26.19|-98.18
Tiangua|Ceara|BR|-3.73|-40.99
Fuorigrotta|Campania|IT|40.83|14.2
Fylde|England|GB|53.83|-2.92
Badagara|Kerala|IN|11.6|75.58
Fazilka|Punjab|IN|30.4|74.03
Rheine|North Rhine-Westphalia|DE|52.29|7.44
Hujra Shah Muqim|Punjab|PK|30.74|73.82
Bawku|Upper East|GH|11.06|-0.24
Bunbury|Western Australia|AU|-33.33|115.64
Shiki|Saitama|JP|35.83|139.58
Upland|CA|US|34.1|-117.65
Crewe|England|GB|53.1|-2.44
Vicosa|Minas Gerais|BR|-20.75|-42.88
Oss|North Brabant|NL|51.77|5.52
Yaxing|Hainan|CN|19.45|109.26
Yuktae-dong|South Hamgyong|KP|40.02|128.16
Dangkao|Phnom Penh|KH|11.51|104.89
Ciudad Satelite|Arequipa|PE|-16.43|-71.53
Fuenfhaus|Vienna|AT|48.2|16.32
Antibes|Provence-Alpes-Cote d'Azur|FR|43.58|7.12
Yangliuqing|Tianjin|CN|39.14|117
Stoney Creek|Ontario|CA|43.22|-79.77
Folsom|CA|US|38.68|-121.18
Modiin Ilit|Jerusalem|IL|31.93|35.04
Bebedouro|Sao Paulo|BR|-20.95|-48.48
Basoko|Tshopo|CD|1.24|23.62
Odendaalsrus|Free State|ZA|-27.87|26.69
Thawi Watthana|Bangkok|TH|13.78|100.38
Electronic City Phase I|Karnataka|IN|12.85|77.66
Aira|Kagoshima|JP|31.77|130.59
Qiuji|Jiangsu|CN|33.8|118
Budapest XXI. keruelet|Budapest|HU|47.42|19.07
Baytown|TX|US|29.74|-94.98
Sant'Ana do Livramento|Rio Grande do Sul|BR|-30.89|-55.53
Furukawa|Miyagi|JP|38.57|140.96
Latina|Lazio|IT|41.47|12.9
Zhlobin|Homyel' Voblasc'|BY|52.89|30.02
Mineralnye Vody|Stavropol Kray|RU|44.21|43.14
Babahoyo|Los Rios|EC|-1.8|-79.52
Midyat|Mardin|TR|37.42|41.34
Lae|Morobe Province|PG|-6.72|147
Matara|Southern Province|LK|5.95|80.54
Manresa|Catalonia|ES|41.73|1.82
Nahavand|Hamadan Province|IR|34.19|48.37
Ramla|Central District|IL|31.93|34.86
Tuban|East Java|ID|-6.9|112.06
Thanh Liet|Hanoi|VN|20.97|105.82
Sakon Nakhon|Sakon Nakhon|TH|17.16|104.15
Ratnagiri|Maharashtra|IN|16.99|73.31
Mbabane|Hhohho Region|SZ|-26.32|31.13
Kiyose|Tokyo|JP|35.78|139.53
Keshod|Gujarat|IN|21.3|70.25
Qingquan|Hubei|CN|30.45|115.26
Viersen|North Rhine-Westphalia|DE|51.25|6.39
Esteio|Rio Grande do Sul|BR|-29.86|-51.18
San Ramon|CA|US|37.78|-121.98
Adzope|Lagunes District|CI|6.11|-3.86
Camden|NJ|US|39.93|-75.12
Bracknell|England|GB|51.41|-0.75
Shibukawa|Gunma|JP|36.48|139
Oleksandriya|Kirovohrad|UA|48.67|33.12
Konnagar|West Bengal|IN|22.71|88.34
Shirbin|Dakahlia|EG|31.2|31.52
Yurihonjo|Akita|JP|39.39|140.06
Ash Shuhada'|Monufia|EG|30.6|30.9
Lake Charles|LA|US|30.21|-93.2
Chintamani|Karnataka|IN|13.4|78.05
Kalamazoo|MI|US|42.29|-85.59
Shouxian|Jiangsu|CN|34.85|116.46
Paharpur|Khyber Pakhtunkhwa|PK|32.11|70.97
Brick|NJ|US|40.06|-74.14
Nagornyy|Moscow|RU|55.65|37.62
Kebomas|East Java|ID|-7.17|112.63
Cinisello Balsamo|Lombardy|IT|45.56|9.21
Itapema|Santa Catarina|BR|-27.09|-48.61
Arlington Heights|IL|US|42.09|-87.98
San Sebastian de los Reyes|Madrid|ES|40.56|-3.63
Plymouth|MN|US|45.01|-93.46
Maymana|Faryab|AF|35.92|64.78
Delmenhorst|Lower Saxony|DE|53.05|8.63
Lintong|Shaanxi|CN|34.38|109.21
La Libertad|Guayas|EC|-2.23|-80.91
South Ozone Park|NY|US|40.67|-73.82
Doral|FL|US|25.82|-80.36
Ciudad Choluteca|Choluteca Department|HN|13.31|-87.18
Pammal|Tamil Nadu|IN|12.97|80.13
Karangsembung|West Java|ID|-6.85|108.64
Buchanan|Grand Bassa County|LR|5.88|-10.05
Mashtul as Suq|Sharqia|EG|30.36|31.38
Sindhnur|Karnataka|IN|15.77|76.76
Sankt Gallen|Saint Gallen|CH|47.42|9.37
Santo Antonio do Descoberto|Goias|BR|-15.94|-48.26
Rolandia|Parana|BR|-23.31|-51.37
Kamensk-Shakhtinsky|Rostov|RU|48.32|40.26
Belovo|Kuzbass|RU|54.42|86.3
Takefu|Fukui|JP|35.9|136.17
Tarub|Central Java|ID|-6.93|109.17
Waterford|MI|US|42.69|-83.41
Madhubani|Bihar|IN|26.35|86.07
Kageleke|Xinjiang|CN|37.3|79.6
Kotido|Northern Region|UG|2.98|34.13
Turbat|Balochistan|PK|26|63.05
Bodinayakkanur|Tamil Nadu|IN|10.01|77.35
Kanjia|Shandong|CN|36.37|119.58
Yinzhu|Shandong|CN|35.88|119.98
Khadki|Maharashtra|IN|18.56|73.85
Battersea|England|GB|51.47|-0.16
Chekhov|Moscow Oblast|RU|55.15|37.46
Bihac|Federation of B&H|BA|44.82|15.87
Souk El Arbaa|Rabat-Sale-Kenitra|MA|34.68|-6
Battaramulla South|Western Province|LK|6.9|79.92
Warabi|Saitama|JP|35.82|139.69
Sapiranga|Rio Grande do Sul|BR|-29.64|-51.01
Ibiuna|Sao Paulo|BR|-23.66|-47.22
Kita|Kayes|ML|13.04|-9.49
Gare|Ile-de-France|FR|48.83|2.38
Dhrangadhra|Gujarat|IN|22.99|71.47
Kryukiv|Poltava|UA|49.03|33.44
Al Karama|Dubai|AE|25.24|55.3
Tezpur|Assam|IN|26.63|92.8
Osijek|County of Osijek-Baranja|HR|45.55|18.69
Lapa|Sao Paulo|BR|-23.52|-46.71
Pila|Greater Poland|PL|53.15|16.74
Nevsehir|Nevsehir Province|TR|38.62|34.71
Evanston|IL|US|42.04|-87.69
Kanaker-Zeytun|Yerevan|AM|40.22|44.54
Gladbeck|North Rhine-Westphalia|DE|51.57|6.99
Ode|Ondo State|NG|7.79|5.71
Miki|Hyogo|JP|34.8|134.98
Manteca|CA|US|37.8|-121.22
Schiedam|South Holland|NL|51.92|4.39
Ra'anana|Central District|IL|32.18|34.87
Doebling|Vienna|AT|48.25|16.33
Saint-Maur-des-Fosses|Ile-de-France|FR|48.79|2.49
Srivilliputhur|Tamil Nadu|IN|9.51|77.63
Anhanguera|Sao Paulo|BR|-23.43|-46.79
Bariq|'Asir Region|SA|18.93|41.93
Ulu Tiram|Johor|MY|1.6|103.82
Chaoyang|Jilin|CN|42.66|126.03
Dawbon|Ayeyarwady|MM|16.52|95.6
Benipur|Bihar|IN|26.06|86.15
Ekpe|Oueme|BJ|6.39|2.54
Kai|Yamanashi|JP|35.68|138.51
East Kilbride|Scotland|GB|55.76|-4.18
Wyoming|MI|US|42.91|-85.71
Krusevac|Central Serbia|RS|43.58|21.33
Hongch'on|Gangwon-do|KR|37.69|127.89
Kampong Chhnang|Kampong Chhnang|KH|12.25|104.67
Trujillo Alto|Trujillo Alto|PR|18.35|-66.01
Shangmei|Hunan|CN|27.74|111.3
Paloncha|Telangana|IN|17.6|80.71
Igbo-Ukwu|Anambra|NG|6.02|7.02
Mek'i|Oromiya|ET|8.15|38.82
Loveland|CO|US|40.4|-105.07
Rundu|Kavango East|NA|-17.92|19.77
Cheektowaga|NY|US|42.9|-78.75
Hove|England|GB|50.83|-0.17
Concordia|Santa Catarina|BR|-27.23|-52.03
Crateus|Ceara|BR|-5.18|-40.67
Fuyu|Heilongjiang|CN|47.79|124.46
Virac|Bicol Region|PH|13.58|124.24
Kings Bridge|NY|US|40.88|-73.91
Pedro Juan Caballero|Amambay Department|PY|-22.55|-55.74
Bismarck|ND|US|46.81|-100.78
Basyun|Gharbia|EG|30.94|30.81
Kpalime|Plateaux|TG|6.9|0.63
Okegawa|Saitama|JP|36|139.56
Kumanovo|Kumanovo|MK|42.13|21.72
Katano|Osaka|JP|34.79|135.69
Gela|Sicily|IT|37.07|14.24
Barra do Dande|Bengo|AO|-8.47|13.37
Feriana|Kasserine Governorate|TN|34.95|8.57
Katoro|Geita|TZ|-3|31.93
Tekstylnyk|Donetsk|UA|47.95|37.7
Cu Chi|Ho Chi Minh City (HCMC)|VN|10.97|106.49
Sukagawa|Fukushima|JP|37.28|140.38
Spijkenisse|South Holland|NL|51.84|4.33
Encarnacion|Itapua|PY|-27.33|-55.87
Aprilia|Lazio|IT|41.59|12.65
Xinying|Taiwan|TW|23.31|120.31
Perris|CA|US|33.78|-117.23
Haninge|Stockholm|SE|59.17|18.14
Maozhou|Guangdong|CN|22.76|113.81
Jaora|Madhya Pradesh|IN|23.64|75.13
Bethlehem|PA|US|40.63|-75.37
Gaevle|Gaevleborg|SE|60.67|17.14
Arnsberg|North Rhine-Westphalia|DE|51.38|8.08
Topi|Khyber Pakhtunkhwa|PK|34.07|72.62
Molepolole|Kweneng|BW|-24.41|25.5
Tura|Meghalaya|IN|25.51|90.2
Gudur|Andhra Pradesh|IN|14.15|79.85
Albany|GA|US|31.58|-84.16
El Tocuyo|Lara|VE|9.79|-69.79
Hihya|Sharqia|EG|30.67|31.59
Huilong|Jiangsu|CN|31.81|121.66
Keren|Anseba|ER|15.78|38.45
Ubud|Bali|ID|-8.51|115.27
Yotsuya|Tokyo|JP|35.69|139.72
Nam Cheong|Sham Shui Po District|HK|22.33|114.15
Beidao|Gansu|CN|34.57|105.89
Troisdorf|North Rhine-Westphalia|DE|50.81|7.15
Moroni|Grande Comore|KM|-11.7|43.26
Aylesbury|England|GB|51.82|-0.81
Valdemoro|Madrid|ES|40.19|-3.68
Bhalwal|Punjab|PK|32.27|72.9
Ciudad Real|Castille-La Mancha|ES|38.99|-3.93
Helmond|North Brabant|NL|51.48|5.66
Yanggu|Shandong|CN|36.11|115.78
Kowloon West End|Kowloon City|HK|22.33|114.19
Alicia|Cagayan Valley|PH|16.78|121.7
Schaumburg|IL|US|42.03|-88.08
Am Timan|Salamat|TD|11.04|20.28
Evosmos|Central Macedonia|GR|40.67|22.91
Parque Do Carmo|Sao Paulo|BR|-23.58|-46.46
Changnyeong|Gyeongsangnam-do|KR|35.54|128.5
Mirpur Mathelo|Sindh|PK|28.02|69.55
Gobernador Galvez|Santa Fe|AR|-33.03|-60.64
Vedado del Cotorro|Havana|CU|23.05|-82.25
Joyo|Kyoto|JP|34.84|135.81
Longgang|Chongqing|CN|29.7|105.71
Banska Bystrica|Banska Bystrica Region|SK|48.74|19.15
Asbest|Sverdlovsk Oblast|RU|57.01|61.46
Narnaul|Haryana|IN|28.04|76.11
Sunamganj|Sylhet Division|BD|25.07|91.4
Cannes|Provence-Alpes-Cote d'Azur|FR|43.55|7.01
Gastonia|NC|US|35.26|-81.19
Irece|Bahia|BR|-11.3|-41.86
Hyosha|North Kivu|CD|0.7|29.52
Brownsville|NY|US|40.66|-73.92
Balotra|Rajasthan|IN|25.83|72.24
Union City|CA|US|37.6|-122.02
Bismil|Diyarbakir Province|TR|37.85|40.66
Aramoko-Ekiti|Ekiti State|NG|7.7|5.04
Katori-shi|Chiba|JP|35.9|140.5
Kharar|Punjab|IN|30.75|76.65
Shancheng|Shandong|CN|34.8|116.08
Bilecik|Bilecik|TR|40.14|29.98
Zhangzhai|Jiangsu|CN|34.62|116.95
Calais|Hauts-de-France|FR|50.95|1.86
Izumiotsu|Osaka|JP|34.5|135.4
Nanma|Shandong|CN|36.18|118.15
Meagui|Bas-Sassandra District|CI|5.41|-6.56
Itsa|Faiyum|EG|29.24|30.79
Huicheng|Anhui|CN|29.87|118.43
Asti|Piedmont|IT|44.9|8.21
Foumbot|West|CM|5.51|10.63
Tatsuno|Hyogo|JP|34.83|134.54
Bolingbrook|IL|US|41.7|-88.07
Yadgir|Karnataka|IN|16.77|77.14
Bosaso|Bari|SO|11.28|49.18
Ramhormoz|Khuzestan|IR|31.28|49.6
Kilifi|Kilifi County|KE|-3.63|39.85
Harda|Madhya Pradesh|IN|22.34|77.1
Yuanshang|Shandong|CN|36.77|120.35
Ragusa|Sicily|IT|36.93|14.72
Silao de la Victoria|Guanajuato|MX|20.94|-101.43
Iowa City|IA|US|41.66|-91.53
Pilkhua|Uttar Pradesh|IN|28.71|77.66
Seosan|Chungcheongnam-do|KR|36.78|126.45
Tosu|Saga|JP|33.37|130.52
Khalandrion|Attica|GR|38.02|23.8
Velez-Malaga|Andalusia|ES|36.78|-4.1
Suixi|Anhui|CN|33.89|116.77
Eusebio|Ceara|BR|-3.89|-38.45
Layton|UT|US|41.06|-111.97
Missouri City|TX|US|29.62|-95.54
Appleton|WI|US|44.26|-88.42
Igbara-Odo|Ekiti State|NG|7.5|5.06
Zhangzhuang|Jiangsu|CN|34.52|117.01
Ambajogai|Maharashtra|IN|18.73|76.39
Meshgin Shahr|Ardabil Province|IR|38.4|47.68
Al Qa'im|Anbar|IQ|34.39|40.99
Shelby|MI|US|42.67|-83.03
Fuentes del Valle|Mexico|MX|19.63|-99.14
Imerintsiatosika|Itasy|MG|-18.98|47.32
Beziers|Occitanie|FR|43.34|3.21
Kapas Herd|Delhi|IN|28.53|77.08
Bafia|Centre|CM|4.75|11.23
Gucheng Chengguanzhen|Hubei|CN|32.27|111.63
Xianshuigu|Tianjin|CN|38.98|117.38
Zaraza|Guarico|VE|9.35|-65.32
Oriximina|Para|BR|-1.77|-55.87
Fort Myers|FL|US|26.62|-81.84
Inuyama|Aichi|JP|35.38|136.94
Bela|Uttar Pradesh|IN|25.92|82
Ostrowiec Swietokrzyski|Swietokrzyskie|PL|50.93|21.39
Sarai Alamgir|Punjab|PK|32.9|73.76
Boynton Beach|FL|US|26.53|-80.07
Wattenscheid|North Rhine-Westphalia|DE|51.48|7.14
Bocholt|North Rhine-Westphalia|DE|51.84|6.62
Yunyang|Henan|CN|33.45|112.71
Casoria|Campania|IT|40.91|14.29
Msalatah|Al Marqab|LY|32.58|14.04
Jonesboro|AR|US|35.84|-90.7
Majene|West Sulawesi|ID|-3.54|118.97
Kortrijk|Flanders|BE|50.83|3.26
Youssoufia|Marrakesh-Safi|MA|32.25|-8.53
Sipalay|Western Visayas|PH|9.75|122.4
Gbadolite|Nord-Ubangi|CD|4.28|21
Rabkavi|Karnataka|IN|16.48|75.11
Pistoia|Tuscany|IT|43.93|10.92
Chimbas|San Juan|AR|-31.49|-68.53
Gandia|Valencia|ES|38.97|-0.18
South Lawndale|IL|US|41.84|-87.71
Prilep|Prilep|MK|41.35|21.55
Ozubulu|Anambra|NG|5.96|6.85
Vlaardingen|South Holland|NL|51.91|4.34
Ifrane|Fes-Meknes|MA|33.53|-5.11
Kyotanabe|Kyoto|JP|34.8|135.77
Bundaberg|Queensland|AU|-24.87|152.35
Aku|Enugu State|NG|6.71|7.32
Huayuan|Jiangxi|CN|28.29|117.21
Shibin al Qanatir|Qalyubia|EG|30.31|31.32
Goianesia|Goias|BR|-15.32|-49.12
Lanxi|Zhejiang|CN|29.22|119.47
Logan Square|IL|US|41.92|-87.7
Oudtshoorn|Western Cape|ZA|-33.6|22.2
Drohobych|Lviv|UA|49.35|23.51
Detmold|North Rhine-Westphalia|DE|51.94|8.87
Bawana|Delhi|IN|28.8|77.03
Al Buraymi|Al Buraimi|OM|24.25|55.79
Kasama|Ibaraki|JP|36.38|140.27
Genhe|Inner Mongolia|CN|50.78|121.52
Gresik|East Java|ID|-7.15|112.66
Birobidzhan|Jewish Autonomous Oblast|RU|48.79|132.92
Oyan|Osun State|NG|8.05|4.77
Shahabad|Uttar Pradesh|IN|27.64|79.94
Chokolivka|Kyiv City|UA|50.42|30.45
Walvis Bay|Erongo Region|NA|-22.96|14.51
Don Carlos|Northern Mindanao|PH|7.68|125
Sewon|Yogyakarta|ID|-7.88|110.36
Virudhachalam|Tamil Nadu|IN|11.51|79.33
Luocheng|Sichuan|CN|29.38|104.03
Kabanjahe|North Sumatra|ID|3.1|98.49
Rapid City|SD|US|44.08|-103.23
Necochea|Buenos Aires|AR|-38.55|-58.74
Chandpur|Uttar Pradesh|IN|29.13|78.27
Cao Bang|Cao Bang Province|VN|22.67|106.26
Targu Jiu|Gorj County|RO|45.05|23.28
Bat Khela|Khyber Pakhtunkhwa|PK|34.62|71.97
Jega|Kebbi|NG|12.22|4.38
Warner Robins|GA|US|32.62|-83.63
Cosmopolis|Sao Paulo|BR|-22.65|-47.2
Heguan|Shandong|CN|36.89|118.57
Solok|West Sumatra|ID|-0.8|100.66
Kasipalaiyam|Tamil Nadu|IN|11.32|77.71
Rochester Hills|MI|US|42.66|-83.15
Viana|Espirito Santo|BR|-20.39|-40.5
Chibuto|Gaza Province|MZ|-24.69|33.53
Canary Wharf|England|GB|51.51|-0.02
Sikandarabad|Uttar Pradesh|IN|28.45|77.7
Asaba|Delta|NG|6.2|6.73
Chilca|Junin|PE|-12.09|-75.21
Cloverdale|British Columbia|CA|49.11|-122.73
Ohafia-Ifigh|Abia State|NG|5.61|7.81
Juegang|Jiangsu|CN|32.32|121.19
Virudunagar|Tamil Nadu|IN|9.59|77.96
Bonao|Monsenor Nouel|DO|18.94|-70.41
Khlong San|Bangkok|TH|13.73|100.51
Yoshikawa|Saitama|JP|35.89|139.84
Belek|Antalya|TR|36.86|31.07
Decatur|IL|US|39.84|-88.95
Kadiyivka|Luhansk|UA|48.57|38.64
Tatvan|Bitlis|TR|38.49|42.28
General Roca|Rio Negro|AR|-39.03|-67.58
Kawit|Calabarzon|PH|14.44|120.9
Fada N'gourma|Est|BF|12.06|0.36
Peterhof|St.-Petersburg|RU|59.88|29.9
Shostka|Sumy|UA|51.86|33.47
Pierrefonds-Roxboro|Quebec|CA|45.5|-73.84
Pacajus|Ceara|BR|-4.17|-38.46
Taman Senai|Johor|MY|1.6|103.64
Dazaifu|Fukuoka|JP|33.51|130.52
Southfield|MI|US|42.47|-83.22
Richard-Toll|Saint-Louis|SN|16.46|-15.7
Pattukkottai|Tamil Nadu|IN|10.42|79.32
Siemianowice Slaskie|Silesia|PL|50.33|19.03
Negele|Oromiya|ET|5.32|39.58
Mayagueez|Mayagueez|PR|18.2|-67.14
Nea Smyrni|Attica|GR|37.95|23.71
Tamiyah|Faiyum|EG|29.48|30.96
Joypur Hat|Rajshahi Division|BD|25.1|89.03
Ishioka|Ibaraki|JP|36.18|140.27
Gaspar|Santa Catarina|BR|-26.93|-48.96
Majalengka|West Java|ID|-6.84|108.23
Pusad|Maharashtra|IN|19.91|77.58
Berdychiv|Zhytomyr Oblast|UA|49.89|28.58
Sihanoukville|Preah Sihanouk|KH|10.61|103.53
Ratchathewi|Bangkok|TH|13.76|100.53
Alegrete|Rio Grande do Sul|BR|-29.78|-55.79
Jatibarang|West Java|ID|-6.47|108.32
Beled Hawo|Gedo|SO|3.93|41.88
Shixing|Guangdong|CN|24.95|114.07
Koch'ang|Jeollabuk-do|KR|35.43|126.7
Rubi|Catalonia|ES|41.49|2.03
Zlin|Zlin|CZ|49.23|17.67
Jurong East||SG|1.33|103.74
Dongdu|Shandong|CN|35.85|117.7
Balanga|Central Luzon|PH|14.68|120.54
San Juan de la Maguana|San Juan Province|DO|18.81|-71.23
Bayreuth|Bavaria|DE|49.95|11.58
Oyem|Woleu-Ntem|GA|1.6|11.58
Rabigh|Mecca Region|SA|22.8|39.03
Lappeenranta|South Karelia|FI|61.06|28.19
Ostrow Wielkopolski|Greater Poland|PL|51.66|17.81
Saint George|UT|US|37.1|-113.58
Padre Las Casas|Araucania|CL|-38.76|-72.6
Rosh Ha'Ayin|Central District|IL|32.1|34.95
Caserta|Campania|IT|41.07|14.33
Dachnoye|St.-Petersburg|RU|59.84|30.26
Bethal|Mpumalanga|ZA|-26.46|29.47
Krathum Baen|Samut Sakhon|TH|13.65|100.26
Nanyuki|Laikipia|KE|0.01|37.07
New Britain|CT|US|41.66|-72.78
Tindivanam|Tamil Nadu|IN|12.23|79.66
Dongkan|Jiangsu|CN|34|119.83
Chopda|Maharashtra|IN|21.25|75.3
Minusinsk|Krasnoyarsk Krai|RU|53.7|91.71
Paine|Santiago Metropolitan|CL|-33.81|-70.74
Almelo|Overijssel|NL|52.36|6.66
Thaba Nchu|Free State|ZA|-29.21|26.84
Selva Alegre|Arequipa|PE|-16.37|-71.53
Huong Tra|Thua Thien Hue Province|VN|16.53|107.48
Huangchuan|Henan|CN|32.14|115.04
Georgiyevsk|Stavropol Kray|RU|44.15|43.47
Daytona Beach|FL|US|29.21|-81.02
Yelabuga|Tatarstan Republic|RU|55.76|52.04
Franklin|TN|US|35.93|-86.87
Naro-Fominsk|Moscow Oblast|RU|55.39|36.73
Port Area|National Capital Region|PH|14.59|120.97
Sitrah|Manama|BH|26.15|50.62
Wusu|Xinjiang|CN|44.43|84.68
Nutana Sector|Saskatchewan|CA|52.1|-106.64
Tala|Monufia|EG|30.68|30.94
Lanxi|Heilongjiang|CN|46.26|126.28
Guamuchil|Sinaloa|MX|25.46|-108.08
Tailandia|Para|BR|-2.95|-48.95
Miyang|Yunnan|CN|24.4|103.44
Ferkessedougou|Savanes District|CI|9.59|-5.19
Taliparamba|Kerala|IN|12.04|75.36
Steglitz Bezirk|State of Berlin|DE|52.46|13.33
Hekinan|Aichi|JP|34.88|136.98
Jiangzhuang|Shandong|CN|36.49|119.79
Beichengqu|Inner Mongolia|CN|40.44|113.15
Gongju|Chungcheongnam-do|KR|36.46|127.12
Arua|Northern Region|UG|3.02|30.91
Candeias|Bahia|BR|-12.67|-38.55
Socopo|Barinas|VE|8.23|-70.82
Sangareddi|Telangana|IN|17.62|78.09
Shumen|Shumen|BG|43.27|26.92
Venado Tuerto|Santa Fe|AR|-33.75|-61.97
Palghar|Maharashtra|IN|19.7|72.77
Marousi|Attica|GR|38.05|23.8
Kalima|Tanganyika|CD|-5.49|28.22
Bangkok Yai|Bangkok|TH|13.72|100.48
Xinzhi|Shanxi|CN|36.5|111.7
Finlyandskiy|Leningradskaya Oblast'|RU|59.97|30.36
Turlock|CA|US|37.49|-120.85
Dharapuram|Tamil Nadu|IN|10.74|77.53
Abancay|Apurimac Department|PE|-13.63|-72.88
Temple|TX|US|31.1|-97.34
Licheng|Jiangsu|CN|31.43|119.48
Sobradinho|Federal District|BR|-15.65|-47.79
Adelaide Hills|South Australia|AU|-34.91|138.71
Guanajuato|Guanajuato|MX|21.02|-101.26
Cascavel|Ceara|BR|-4.13|-38.24
Suva Reka|Prizren|XK|42.36|20.82
West Ridge|IL|US|42|-87.69
Rades|Ben Arous Governorate|TN|36.77|10.27
K'olito|Central Ethiopia Regional State|ET|7.32|38.08
Chiryu|Aichi|JP|35|137.03
Ash Shafa|Mecca Region|SA|21.07|40.32
Apple Valley|CA|US|34.5|-117.19
Sagay|Western Visayas|PH|10.94|123.42
Sarnia|Ontario|CA|42.98|-82.4
Kyosai|Gyeongsangnam-do|KR|34.85|128.59
Myslowice|Silesia|PL|50.21|19.17
Payyanur|Kerala|IN|12.09|75.2
Otawara|Tochigi|JP|36.87|140.03
Casa Nova|Bahia|BR|-9.17|-40.98
Nizwa|Ad Dakhiliyah|OM|22.93|57.53
Zhoucheng|Shandong|CN|35.91|116.31
Sault Ste. Marie|Ontario|CA|46.52|-84.33
Sakrand|Sindh|PK|26.14|68.27
Itapira|Sao Paulo|BR|-22.44|-46.82
Thi Tran Mao Khe|Quang Ninh|VN|21.06|106.59
Mariano Roque Alonso|Central Department|PY|-25.21|-57.53
Rio do Sul|Santa Catarina|BR|-27.21|-49.64
Larnaca|Larnaka|CY|34.92|33.63
Purley|England|GB|51.34|-0.11
Bandar Saujana Utama|Selangor|MY|3.21|101.48
Al Lith|Mecca Region|SA|20.15|40.27
Bromma|Stockholm|SE|59.34|17.94
Lynwood|CA|US|33.93|-118.21
La Paz|Central Luzon|PH|15.44|120.73
Waukesha|WI|US|43.01|-88.23
Le Bardo|Tunis Governorate|TN|36.81|10.13
Gouda|South Holland|NL|52.02|4.71
Sheopur|Madhya Pradesh|IN|25.66|76.7
Channapatna|Karnataka|IN|12.65|77.21
Bothaville|Free State|ZA|-27.39|26.62
Ararangua|Santa Catarina|BR|-28.94|-49.5
Antalaha|Sava|MG|-14.9|50.28
Caidian|Hubei|CN|30.58|114.03
Busia|Busia County|KE|0.46|34.11
Canton|OH|US|40.8|-81.38
Guildford|England|GB|51.24|-0.57
Koyilandy|Kerala|IN|11.44|75.69
Mbouda|West|CM|5.63|10.25
Afikpo|Ebonyi State|NG|5.89|7.94
Landshut|Bavaria|DE|48.53|12.16
Santa Lucia|Canary Islands|ES|27.91|-15.54
Gulfport|MS|US|30.37|-89.09
Panzos|Alta Verapaz|GT|15.4|-89.64
Sunzha|Ingushetiya Republic|RU|43.32|45.05
Santa Isabel do Para|Para|BR|-1.3|-48.16
Amatitlan|Guatemala|GT|14.48|-90.63
Castro|Parana|BR|-24.79|-50.01
Livyi Bereh|Dnipropetrovsk|UA|48.59|34.56
Saint John|New Brunswick|CA|45.27|-66.06
Sao Sebastiao do Paraiso|Minas Gerais|BR|-20.92|-46.99
Faridpur|Uttar Pradesh|IN|28.21|79.54
Tando Jam|Sindh|PK|25.43|68.53
Yueksekova|Hakkari|TR|37.57|44.29
Birkhadem|Algiers|DZ|36.71|3.05
Zaandam|North Holland|NL|52.44|4.83
Boras|Vaestra Goetaland|SE|57.72|12.94
Shakhtarsk|Donetsk|UA|48.06|38.44
Nyvky|Kyiv City|UA|50.46|30.41
Manikganj|Dhaka Division|BD|23.86|90.01
Esbjerg|South Denmark|DK|55.47|8.45
Bouar|Nana-Mambere|CF|5.93|15.6
Migori|Migori County|KE|-1.06|34.47
Barauni|Bihar|IN|25.47|85.98
Yawata|Kyoto|JP|34.87|135.7
Apomu|Osun State|NG|7.35|4.18
Minami-Alps|Yamanashi|JP|35.62|138.46
Xiuyan|Liaoning|CN|40.29|123.27
Darayya|Rif-dimashq|SY|33.46|36.23
Delgado|San Salvador Department|SV|13.72|-89.17
Pawtucket|RI|US|41.88|-71.38
Chernogorsk|Khakasiya Republic|RU|53.83|91.31
Lauderhill|FL|US|26.14|-80.21
Peckham|England|GB|51.47|-0.07
Rock Hill|SC|US|34.92|-81.03
Khanabad|Kunduz|AF|36.68|69.11
Sragen|Central Java|ID|-7.43|111.02
Luohuang|Chongqing|CN|29.35|106.44
Madinat as Sadat|Beheira|EG|30.37|30.51
Takestan|Qazvin Province|IR|36.07|49.7
Campo Formoso|Bahia|BR|-10.51|-40.32
Dias d'Avila|Bahia|BR|-12.61|-38.3
Fuengirola|Andalusia|ES|36.54|-4.62
Solana|Cagayan Valley|PH|17.65|121.69
Shangsi|Guangxi|CN|22.16|107.98
Fiditi|Oyo State|NG|7.71|3.92
Silver Spring|MD|US|38.99|-77.03
Barnsley|England|GB|53.55|-1.48
Qarasu|Xinjiang|CN|44.2|80.42
Tokmok|Chuy Region|KG|42.84|75.3
Yumbo|Valle del Cauca Department|CO|3.58|-76.49
Borongan|Eastern Visayas|PH|11.61|125.43
Yukuhashi|Fukuoka|JP|33.73|130.98
Medenine|Medenine Governorate|TN|33.35|10.51
Triyuga|Koshi|NP|26.79|86.7
Shahrixon|Andijan Region|UZ|40.71|72.06
Oroquieta|Northern Mindanao|PH|8.49|123.8
Upington|Northern Cape|ZA|-28.45|21.26
Trujillo|Trujillo|VE|9.37|-70.44
Don Torcuato|Buenos Aires|AR|-34.49|-58.63
Zelenogorsk|Krasnoyarsk Krai|RU|56.11|94.59
West Gulfport|MS|US|30.4|-89.09
Lowestoft|England|GB|52.48|1.75
Krishnagiri|Tamil Nadu|IN|12.52|78.21
Parys|Free State|ZA|-26.9|27.46
Agios Dimitrios|Attica|GR|37.93|23.73
Sopur|Jammu and Kashmir|IN|34.29|74.47
Yalova|Yalova|TR|40.66|29.28
Winneba|Central|GH|5.35|-0.62
Szolnok|Jasz-Nagykun-Szolnok|HU|47.18|20.2
Changtu|Liaoning|CN|42.78|124.1
Ban Ko Sire|Phuket|TH|7.89|98.43
Vaexjoe|Kronoberg|SE|56.88|14.81
Huashan|Jiangsu|CN|34.63|116.74
Ilidza|Federation of B&H|BA|43.83|18.31
Lueneburg|Lower Saxony|DE|53.25|10.42
Tolanaro|Anosy|MG|-25.03|46.98
El Pueblito|Queretaro|MX|20.54|-100.44
Flower Mound|TX|US|33.01|-97.1
Stargard|West Pomerania|PL|53.34|15.05
Cremona|Lombardy|IT|45.13|10.02
Rayagada|Odisha|IN|19.17|83.41
Serendah|Selangor|MY|3.36|101.6
Anlu|Hubei|CN|31.26|113.68
Guasave|Sinaloa|MX|25.57|-108.47
Fernandopolis|Sao Paulo|BR|-20.28|-50.25
Yilan|Heilongjiang|CN|46.32|129.56
Zahirabad|Telangana|IN|17.68|77.61
Sur|Southeastern Governorate|OM|22.57|59.53
Linjiang|Chongqing|CN|31.1|108.22
Carpi|Emilia-Romagna|IT|44.78|10.88
Khopoli|Maharashtra|IN|18.79|73.35
San Francisco del Rincon|Guanajuato|MX|21.02|-101.86
Centreville|VA|US|38.84|-77.43
Grazhdanka|St.-Petersburg|RU|60.02|30.42
Ratangarh|Rajasthan|IN|28.08|74.62
Lafayette|IN|US|40.42|-86.88
Moanda|Haut-Ogooue|GA|-1.57|13.2
Thakurgaon|Rangpur Division|BD|26.03|88.47
Hala|Sindh|PK|25.81|68.42
Markapur|Andhra Pradesh|IN|15.74|79.27
Passaic|NJ|US|40.86|-74.13
Billstedt|Hamburg|DE|53.55|10.13
Guiping|Guangxi|CN|23.39|110.07
Gemlik|Bursa Province|TR|40.43|29.16
Campo Belo|Sao Paulo|BR|-23.63|-46.67
Tenri|Nara|JP|34.58|135.83
Riverview|FL|US|27.87|-82.33
Kalamassery|Kerala|IN|10.06|76.33
Sougueur|Tiaret|DZ|35.19|1.5
Redlands|CA|US|34.06|-117.18
Orita-Eruwa|Oyo State|NG|7.56|3.44
Zografos|Attica|GR|37.98|23.77
Missoula|MT|US|46.87|-113.99
Rancho Cordova|CA|US|38.59|-121.3
Farshut|Qena|EG|26.06|32.16
Celle|Lower Saxony|DE|52.62|10.08
Prymorskyi|Donetsk|UA|47.07|37.5
Bolpur|West Bengal|IN|23.66|87.7
Panjim|Goa|IN|15.5|73.83
Ranaghat|West Bengal|IN|23.18|88.57
Horizonte|Ceara|BR|-4.1|-38.49
Tanabe|Wakayama|JP|33.73|135.37
Doba|Logone Oriental|TD|8.66|16.85
Hongwon|South Hamgyong|KP|40.03|127.96
Aubervilliers|Ile-de-France|FR|48.92|2.38
Indaial|Santa Catarina|BR|-26.9|-49.23
Wilmington|DE|US|39.75|-75.55
Al Ghanayim|Asyut|EG|26.88|31.33
Kuandian|Liaoning|CN|40.73|124.78
Gwadar|Balochistan|PK|25.12|62.33
Kien Hung|Hanoi|VN|20.96|105.79
Musashimurayama|Tokyo|JP|35.74|139.43
Shenzhen City Centre|Guangdong|CN|22.54|114.08
Vila Nova de Gaia|Porto|PT|41.12|-8.61
Ain Temouchent|Ain Temouchent|DZ|35.3|-1.14
Uwajima|Ehime|JP|33.22|132.56
Ejura|Ashanti|GH|7.39|-1.36
Poyang|Jiangxi|CN|28.99|116.67
Yongfeng|Hunan|CN|27.45|112.17
Lahraouyine|Casablanca-Settat|MA|33.54|-7.53
Kopeysk|Chelyabinsk|RU|55.12|61.62
Eha Amufu|Enugu State|NG|6.66|7.76
Fatehabad|Haryana|IN|29.52|75.46
Bapatla|Andhra Pradesh|IN|15.9|80.47
Soedertaelje|Stockholm|SE|59.2|17.63
Gongchangling|Liaoning|CN|41.12|123.45
Beypore|Kerala|IN|11.17|75.81
Bir el Ater|Tebessa|DZ|34.74|8.06
Jimo|Shandong|CN|36.39|120.46
Malumfashi|Katsina State|NG|11.79|7.62
Co GJo|Hanoi|VN|21.28|105.36
Janauba|Minas Gerais|BR|-15.8|-43.31
Koppal|Karnataka|IN|15.35|76.15
Buenavista|Caraga|PH|8.98|125.41
Al Qanayat|Sharqia|EG|30.62|31.46
Pala|Mayo-Kebbi Ouest|TD|9.36|14.91
Tongyeong|Gyeongsangnam-do|KR|34.85|128.43
Badvel|Andhra Pradesh|IN|14.75|79.06
Antanifotsy|Vakinankaratra|MG|-19.65|47.32
Dialakorodji|Koulikoro|ML|12.7|-7.96
Sherwood Park|Alberta|CA|53.52|-113.32
Dadri|Uttar Pradesh|IN|28.55|77.55
Kurortnyy|Leningradskaya Oblast'|RU|60.17|29.91
Chingford|England|GB|51.63|0
Samar|Dnipropetrovsk|UA|48.63|35.26
Thenkasi|Tamil Nadu|IN|8.96|77.32
New Braunfels|TX|US|29.7|-98.12
Pabianice|Lodz Voivodeship|PL|51.66|19.35
Altamura|Apulia|IT|40.83|16.55
Berekum|Bono|GH|7.45|-2.58
Suratgarh|Rajasthan|IN|29.32|73.9
Santa Maria Chimalhuacan|Mexico|MX|19.42|-98.95
Mariano|Northern Mindanao|PH|8.83|125.12
Auraiya|Uttar Pradesh|IN|26.47|79.51
Lamezia Terme|Calabria|IT|38.96|16.31
Vol'sk|Saratov Oblast|RU|52.04|47.38
Nungua|Greater Accra|GH|5.6|-0.08
Bailundo|Malanje|AO|-9.57|15.99
Halmstad|Halland|SE|56.67|12.86
Cherry Hill|NJ|US|39.93|-75.03
Mykytivskyi|Donetsk|UA|48.31|38
Baiquan|Heilongjiang|CN|47.61|126.08
Beloretsk|Bashkortostan Republic|RU|53.96|58.4
Palani|Tamil Nadu|IN|10.45|77.52
Benidorm|Valencia|ES|38.54|-0.13
Contramaestre|Santiago de Cuba Province|CU|20.3|-76.24
Nabeul|Nabeul Governorate|TN|36.46|10.74
Ishimbay|Bashkortostan Republic|RU|53.45|56.04
Alamata|Tigray|ET|12.42|39.56
Capanema|Para|BR|-1.2|-47.18
Pagar Alam|South Sumatra|ID|-4.03|103.25
Grande Prairie|Alberta|CA|55.17|-118.8
Linares|Nuevo Leon|MX|24.86|-99.57
Bayramaly|Mary|TM|37.62|62.17
Jiangyan|Jiangsu|CN|32.51|120.14
Maidenhead|England|GB|51.52|-0.72
Shiguai|Inner Mongolia|CN|40.71|110.29
Faro|Faro|PT|37.02|-7.93
Maebaru-chuo|Fukuoka|JP|33.56|130.2
Eniwa|Hokkaido|JP|42.89|141.58
Flagstaff|AZ|US|35.2|-111.65
Ritto|Shiga|JP|35.03|136
Chivacoa|Yaracuy|VE|10.16|-68.89
Farroupilha|Rio Grande do Sul|BR|-29.23|-51.35
Anan|Tokushima|JP|33.92|134.65
Martil|Tanger-Tetouan-Al Hoceima|MA|35.62|-5.28
Danao|Central Visayas|PH|10.52|124.03
Gniezno|Greater Poland|PL|52.53|17.58
Brumado|Bahia|BR|-14.2|-41.67
Alphen aan den Rijn|South Holland|NL|52.13|4.66
Kadirli|Osmaniye|TR|37.37|36.1
Goya|Corrientes|AR|-29.14|-59.26
Chau GJoc|An Giang|VN|10.7|105.12
Phaya Thai|Bangkok|TH|13.78|100.54
Darab|Fars|IR|28.75|54.54
Sirvan|Shirvan|AZ|39.94|48.93
Schweizer-Reneke|North West|ZA|-27.19|25.33
Adler|Krasnodar Krai|RU|43.43|39.92
Dimbokro|Lacs District|CI|6.65|-4.71
Confederation|Saskatchewan|CA|52.14|-106.7
Fuyang|Zhejiang|CN|30.05|119.95
Faranah|Faranah|GN|10.04|-10.74
Haining|Zhejiang|CN|30.54|120.69
Dogubayazit|Agri|TR|39.55|44.08
Alcala de Guadaira|Andalusia|ES|37.34|-5.84
Shankou|Guangxi|CN|21.6|109.72
Chapayevsk|Samara Oblast|RU|52.98|49.71
Stafford|England|GB|52.81|-2.12
Mauban|Calabarzon|PH|14.19|121.73
Tsurugashima|Saitama|JP|35.96|139.4
Nallur|Tamil Nadu|IN|11.1|77.39
Taungdwingyi|Magway|MM|20.01|95.55
Inaruwa|Koshi|NP|26.61|87.15
Indang|Calabarzon|PH|14.2|120.88
Muncie|IN|US|40.19|-85.39
Mineiros|Goias|BR|-17.57|-52.55
Pan'an|Gansu|CN|34.75|105.11
Grajau|Maranhao|BR|-5.82|-46.14
Cahama|Cunene|AO|-16.29|14.31
Bamberg|Bavaria|DE|49.9|10.9
Khalis|Diyala|IQ|33.81|44.53
Ayvalik|Balikesir|TR|39.32|26.69
Uxbridge|England|GB|51.55|-0.48
Baikonur|Baikonur|KZ|45.62|63.32
Dainava (Kaunas)|Kaunas|LT|54.92|23.97
Rabwah|Punjab|PK|31.76|72.91
Fordon|Kujawsko-Pomorskie|PL|53.15|18.17
Vikindu|Pwani|TZ|-7.01|39.3
Mira Mesa|CA|US|32.92|-117.14
Woodland Hills|CA|US|34.17|-118.61
Linh GJam|Hanoi|VN|20.96|105.83
Raha|Southeast Sulawesi|ID|-4.84|122.72
Duyen Hai|Vinh Long|VN|9.63|106.49
Weston|FL|US|26.1|-80.4
Imola|Emilia-Romagna|IT|44.36|11.71
Aigaleo|Attica|GR|37.98|23.68
Izmayil|Odesa|UA|45.35|28.84
Mengcheng Chengguanzhen|Anhui|CN|33.27|116.57
San Joaquin|Carabobo|VE|10.26|-67.79
Abhar|Zanjan|IR|36.15|49.22
Xinhe|Shandong|CN|36.92|119.59
Moquegua|Moquegua Department|PE|-17.2|-70.94
Shima|Chongqing|CN|28.99|105.92
Gueira de Melena|Artemisa|CU|22.8|-82.51
Chamrajnagar|Karnataka|IN|11.92|76.94
Mertoyudan|Central Java|ID|-7.52|110.23
Consolacion del Sur|Pinar del Rio|CU|22.51|-83.51
Mithepur|Delhi|IN|28.5|77.32
Vaasa|Ostrobothnia|FI|63.1|21.62
Segamat|Johor|MY|2.51|102.82
Rajbiraj|Madhesh|NP|26.54|86.75
Ciro|Central Ethiopia Regional State|ET|7.83|38.23
Vidradnyi|Kyiv City|UA|50.43|30.42
Merignac|New Aquitaine|FR|44.84|-0.65
Bondowoso|East Java|ID|-7.91|113.82
Satpayev|Ulytau Region|KZ|47.9|67.54
Santa Cruz de Mara|Zulia|VE|10.79|-71.69
Mangrol|Gujarat|IN|21.12|70.11
Kahror Pakka|Punjab|PK|29.62|71.91
Kladno|Central Bohemia|CZ|50.15|14.1
Kaura Namoda|Zamfara State|NG|12.59|6.59
Basavakalyan|Karnataka|IN|17.87|76.95
Planeta Rica|Cordoba|CO|8.41|-75.59
Asosa|Binshangul Gumuz|ET|10.07|34.53
Las Piedras|Canelones|UY|-34.73|-56.22
Pul Pehlad|Delhi|IN|28.5|77.29
Tacarigua|Carabobo|VE|10.09|-67.92
Abu 'Arish|Jazan Region|SA|16.97|42.83
Bairro Parque Nossa Senhora do Carmo|Sao Paulo|BR|-23.41|-46.32
Khash|Sistan and Baluchestan|IR|28.22|61.22
Fengping|Yunnan|CN|24.4|98.52
Brossard|Quebec|CA|45.45|-73.47
Chaibasa|Jharkhand|IN|22.55|85.8
Dougnane|Thies|SN|14.96|-16.87
Tournai|Wallonia|BE|50.61|3.39
Yokota|Tokyo|JP|35.75|139.38
Linares|Maule Region|CL|-35.85|-71.59
Rhondda|Wales|GB|51.66|-3.45
Biguacu|Santa Catarina|BR|-27.49|-48.66
Karonga|Northern Region|MW|-9.93|33.93
Frederick|MD|US|39.41|-77.41
Fuefuki|Yamanashi|JP|35.64|138.64
Frontera|Coahuila|MX|26.93|-101.45
Minamiarupusu|Yamanashi|JP|35.61|138.46
Villa Carlos Paz|Cordoba|AR|-31.42|-64.49
Pasco|WA|US|46.24|-119.1
Mobarakeh|Isfahan|IR|32.35|51.5
Thanlyin|Yangon|MM|16.77|96.25
Dobrich|Dobrich|BG|43.56|27.83
Chengxian Chengguanzhen|Gansu|CN|33.75|105.73
Pittsburg|CA|US|38.03|-121.88
Luquembo|Malanje|AO|-10.74|17.72
Nui Thanh|Da Nang City|VN|15.43|108.66
Sayyan|Sanaa Governorate|YE|15.17|44.32
Tripunittura|Kerala|IN|9.94|76.33
Bongabon|Central Luzon|PH|15.63|121.14
Gujar Khan|Punjab|PK|33.25|73.3
Kungsholmen|Stockholm|SE|59.33|18.04
Xininglu|Xinjiang|CN|44.34|84.9
Kot Malik Barkhurdar|Balochistan|PK|30.2|66.99
Chuhar Kana|Punjab|PK|31.75|73.8
Ridgewood|NY|US|40.7|-73.91
Palatine|IL|US|42.11|-88.03
Kampung Baru Balakong|Selangor|MY|3.03|101.75
Toyoake|Aichi|JP|35.04|137
Bitola|Bitola|MK|41.03|21.34
Ambovombe|Androy|MG|-25.18|46.09
Shajapur|Madhya Pradesh|IN|23.43|76.28
Anseong|Gyeonggi-do|KR|37.01|127.27
Xuantan|Sichuan|CN|29.21|105.57
Jiehu|Shandong|CN|35.54|118.45
Bargny|Dakar|SN|14.7|-17.23
Odate|Akita|JP|40.27|140.56
Verdun|Quebec|CA|45.46|-73.57
Suwalki|Podlasie|PL|54.11|22.93
Mettupalayam|Tamil Nadu|IN|11.3|76.93
North Richland Hills|TX|US|32.83|-97.23
San Leonardo|Central Luzon|PH|15.36|120.96
Valdefuentes|Madrid|ES|40.49|-3.64
Union City|NJ|US|40.78|-74.02
Kissimmee|FL|US|28.3|-81.42
Linjiang|Jilin|CN|41.81|126.91
Hunedoara|Hunedoara County|RO|45.75|22.9
Las Cumbres|Panama|PA|9.09|-79.54
San Carlo All'Arena|Campania|IT|40.87|14.26
Khlong Kum|Bangkok|TH|13.79|100.68
Sunam|Punjab|IN|30.13|75.8
Tantou|Fujian|CN|26.03|119.6
Bhawanipatna|Odisha|IN|19.91|83.17
Soja|Okayama|JP|34.68|133.75
Mindelo|Sao Vicente|CV|16.89|-24.98
Ostend|Flanders|BE|51.22|2.93
Nganjuk|East Java|ID|-7.61|111.9
Sint-Niklaas|Flanders|BE|51.17|4.14
Chicoutimi|Quebec|CA|48.42|-71.06
Calauag|Calabarzon|PH|13.96|122.29
Xiaoshi|Liaoning|CN|41.3|124.12
Ziauddin Pur|Delhi|IN|28.71|77.28
Lencois Paulista|Sao Paulo|BR|-22.6|-48.8
Bocono|Trujillo|VE|9.25|-70.25
Magalang|Central Luzon|PH|15.22|120.66
Ihnasya al Madinah|Beni Suweif|EG|29.09|30.94
Jamkhandi|Karnataka|IN|16.5|75.29
Bogale|Ayeyarwady|MM|16.29|95.4
Gueines|Mayabeque|CU|22.84|-82.03
Royal Tunbridge Wells|England|GB|51.13|0.26
Walnut Creek|CA|US|37.91|-122.06
Ad Dilinjat|Beheira|EG|30.83|30.54
Darnytskyi Masyv|Kyiv City|UA|50.44|30.63
Koson|Qashqadaryo|UZ|39.04|65.58
Cantaura|Anzoategui|VE|9.31|-64.36
Granada|Meta Department|CO|3.55|-73.71
Inongo|Mai-Ndombe|CD|-1.93|18.29
Hoorn|North Holland|NL|52.64|5.06
Basmat|Maharashtra|IN|19.33|77.16
Libon|Bicol Region|PH|13.3|123.44
Assen|Drenthe|NL|53|6.56
Chulucanas|Piura|PE|-5.09|-80.16
Tuymazy|Bashkortostan Republic|RU|54.61|53.71
Taj Pul|Delhi|IN|28.49|77.31
Enugu-Ukwu|Anambra|NG|6.17|7.01
Cordova|TN|US|35.16|-89.78
Moriya|Ibaraki|JP|35.93|140
Ito|Shizuoka|JP|34.97|139.08
Yachimata|Chiba|JP|35.65|140.32
Cabedelo|Paraiba|BR|-6.98|-34.83
Venancio Aires|Rio Grande do Sul|BR|-29.61|-52.19
Ponferrada|Castille and Leon|ES|42.55|-6.6
Itapecuru Mirim|Maranhao|BR|-3.39|-44.36
Jinjiang|Hainan|CN|19.74|110.01
Lupon|Davao Region|PH|6.9|126.01
Gion|Hiroshima|JP|34.43|132.47
Idah|Kogi State|NG|7.11|6.74
Yunmen|Chongqing|CN|30.08|106.32
Lys'va|Perm Krai|RU|58.11|57.81
Knysna|Western Cape|ZA|-34.04|23.05
Wushan|Gansu|CN|34.72|104.89
Kayamkulam|Kerala|IN|9.18|76.5
Mount Vernon|NY|US|40.91|-73.84
Darya Khan|Punjab|PK|31.78|71.1
Dharmapuri|Tamil Nadu|IN|12.13|78.16
Heishan|Liaoning|CN|41.69|122.11
Conroe|TX|US|30.31|-95.46
Borisoglebsk|Voronezh Oblast|RU|51.37|42.1
Obonoma|Rivers State|NG|4.71|6.79
Dothan|AL|US|31.22|-85.39
Sosnovyy Bor|Leningradskaya Oblast'|RU|59.9|29.09
Feodosiya|Crimea|UA|45.03|35.38
Aschaffenburg|Bavaria|DE|49.98|9.15
Bouira|Bouira|DZ|36.37|3.9
Chinchina|Caldas Department|CO|4.98|-75.6
Ouricuri|Pernambuco|BR|-7.88|-40.08
Budapest XVI. keruelet|Budapest|HU|47.51|19.17
Tsuruga|Fukui|JP|35.65|136.06
Haemeenlinna|Kanta-Haeme|FI|61|24.46
Northridge|CA|US|34.23|-118.54
Waterloo|IA|US|42.49|-92.34
Tanauan|Calabarzon|PH|14.09|121.15
Pengcheng|Hebei|CN|36.43|114.17
Wenjiang|Sichuan|CN|28.39|104.56
Al Balyana|Sohag|EG|26.24|32
Rivas-Vaciamadrid|Madrid|ES|40.33|-3.51
Sheki|Shaki City|AZ|41.19|47.17
Nakivale Refugee Camp|Western Region|UG|-0.74|31
Maple Grove|MN|US|45.07|-93.46
Baranoa|Atlantico|CO|10.79|-74.92
Shima|Fujian|CN|24.45|117.81
Aparri|Cagayan Valley|PH|18.36|121.64
Bisalpur|Uttar Pradesh|IN|28.29|79.8
Peruibe|Sao Paulo|BR|-24.32|-47
Ninghai|Zhejiang|CN|29.29|121.42
Framingham|MA|US|42.28|-71.42
San Isidro|Lima region|PE|-12.1|-77.04
Ico|Ceara|BR|-6.4|-38.86
Sabae|Fukui|JP|35.95|136.18
Al Fahahil|Al Ahmadi|KW|29.08|48.13
Saldanha|Western Cape|ZA|-33.01|17.94
Adrar|Adrar|DZ|27.87|-0.29
Issia|Sassandra-Marahoue|CI|6.49|-6.59
Dolgoprudnyy|Moscow Oblast|RU|55.95|37.5
Formiga|Minas Gerais|BR|-20.46|-45.43
Soeke|Aydin|TR|37.75|27.41
Altagracia de Orituco|Guarico|VE|9.86|-66.38
Nghia Lo|Lao Cai|VN|21.6|104.52
Attili|Andhra Pradesh|IN|16.7|81.6
Wimbledon|England|GB|51.42|-0.21
Ina|Nagano|JP|35.83|137.95
Redondo Beach|CA|US|33.85|-118.39
Corby|England|GB|52.5|-0.69
Ain Harrouda|Casablanca-Settat|MA|33.64|-7.45
Notre-Dame-de-Grace|Quebec|CA|45.48|-73.61
Langarud|Gilan Province|IR|37.2|50.15
Guiglo|Montagnes|CI|6.54|-7.49
Cadereyta Jimenez|Nuevo Leon|MX|25.59|-100
Majadahonda|Madrid|ES|40.47|-3.87
Bossier City|LA|US|32.52|-93.73
Cumbum|Tamil Nadu|IN|9.74|77.28
Moron|Carabobo|VE|10.49|-68.2
Neubrandenburg|Mecklenburg-Vorpommern|DE|53.56|13.26
Artemisa|Artemisa|CU|22.81|-82.76
Valle de Santiago|Guanajuato|MX|20.39|-101.19
Stamford Hill|England|GB|51.57|-0.07
Sanlucar de Barrameda|Andalusia|ES|36.78|-6.35
Bir el Djir|Oran|DZ|35.72|-0.55
Bungoma|Bungoma County|KE|0.56|34.56
Macenta|Nzerekore Region|GN|8.54|-9.47
Amparo|Sao Paulo|BR|-22.7|-46.76
Munnar|Kerala|IN|10.09|77.06
Dorogomilovo|Moscow|RU|55.74|37.55
Balanbale|Galguduud|SO|5.77|45.76
Panipat Taraf Makhdum Zadgan|Haryana|IN|29.42|76.99
Cadereyta|Nuevo Leon|MX|25.58|-99.98
Bourges|Centre-Val de Loire|FR|47.08|2.4
Yorba Linda|CA|US|33.89|-117.81
Nabha|Punjab|IN|30.38|76.15
Mustamaee|Harjumaa|EE|59.4|24.68
Ardesen|Rize Province|TR|41.19|40.98
Chaihe|Heilongjiang|CN|44.76|129.68
Budyonnovsk|Stavropol Kray|RU|44.78|44.17
Bihat|Bihar|IN|25.43|86.02
Minggang|Henan|CN|32.46|114.05
Tangzhai|Anhui|CN|34.43|116.59
Xunyang|Shaanxi|CN|32.82|109.37
Barberton|Mpumalanga|ZA|-25.79|31.05
Samastipur|Bihar|IN|25.86|85.78
Calbayog City|Eastern Visayas|PH|12.07|124.6
Belogorsk|Amur Oblast|RU|50.91|128.51
Hashima|Gifu|JP|35.33|136.68
Karanja|Maharashtra|IN|20.48|77.49
Strovolos|Nicosia|CY|35.15|33.33
Campina|Andalusia|ES|38.22|-2.98
Yanghe|Ningxia|CN|38.28|106.25
Gode|Somali|ET|5.95|43.55
Concepcion del Uruguay|Entre Rios|AR|-32.48|-58.23
San Mateo Atenco|Mexico|MX|19.27|-99.53
Angat|Central Luzon|PH|14.93|121.03
Woodbury|MN|US|44.92|-92.96
San Fernando|Ucayali|PE|-8.4|-74.54
Tanjung Selor|North Kalimantan|ID|2.84|117.37
Conceicao do Coite|Bahia|BR|-11.56|-39.28
Dongfeng|Jilin|CN|42.67|125.53
Roman|Neamt County|RO|46.92|26.93
Sitamarhi|Bihar|IN|26.59|85.49
Barlad|Vaslui County|RO|46.23|27.67
Blagoevgrad|Blagoevgrad|BG|42.01|23.1
Deva|Hunedoara County|RO|45.88|22.9
Kamuli|Eastern Region|UG|0.95|33.12
Xo'jayli Shahri|Karakalpakstan|UZ|42.41|59.45
Rajsamand|Rajasthan|IN|25.07|73.88
Huamak|Bangkok|TH|13.76|100.65
Kaga|Ishikawa|JP|36.3|136.33
Tamano|Okayama|JP|34.52|133.95
Quillota|Valparaiso|CL|-32.88|-71.25
Eau Claire|WI|US|44.81|-91.5
Jiang'an|Sichuan|CN|28.73|105.07
Kesklinn|Harjumaa|EE|59.44|24.76
Saraburi|Saraburi|TH|14.53|100.92
Ishim|Tyumen Oblast|RU|56.11|69.49
Zhenlai|Jilin|CN|45.85|123.2
Velsen-Zuid|North Holland|NL|52.46|4.65
Waldorf|MD|US|38.62|-76.94
Dessau|Saxony-Anhalt|DE|51.84|12.25
Malkapur|Maharashtra|IN|20.89|76.2
La Carlota|Western Visayas|PH|10.42|122.92
Santo Domingo Tehuantepec|Oaxaca|MX|16.32|-95.24
Shuangfengqiao|Chongqing|CN|29.72|106.63
Forest Hills|NY|US|40.72|-73.85
Apac|Northern Region|UG|1.98|32.54
Damghan|Semnan|IR|36.17|54.34
Mococa|Sao Paulo|BR|-21.47|-47
Hwadae|North Hamgyong|KP|40.84|129.5
Ji'an|Jilin|CN|41.13|126.19
Songjianghe|Jilin|CN|42.19|127.48
Ede|Gelderland|NL|52.03|5.66
Davis|CA|US|38.54|-121.74
Subic|Central Luzon|PH|14.88|120.23
Sirnak|Sirnak|TR|37.51|42.45
Tsushima|Aichi|JP|35.17|136.72
Yan Besar|Kedah|MY|5.8|100.37
Palang|Dhaka Division|BD|23.22|90.35
Modasa|Gujarat|IN|23.46|73.3
Glen Burnie|MD|US|39.16|-76.62
Arenella|Campania|IT|40.86|14.22
Banepa|Bagmati Province|NP|27.63|85.52
Agbor|Delta|NG|6.25|6.19
Camarillo|CA|US|34.22|-119.04
Jaisalmer|Rajasthan|IN|26.92|70.9
Xacmaz|Xacmaz|AZ|41.46|48.81
Luorong|Guangxi|CN|24.41|109.61
Tome-Acu|Para|BR|-2.42|-48.15
Kovel|Volyn|UA|51.22|24.7
Victoria|TX|US|28.81|-97
Trapani|Sicily|IT|38.02|12.54
Paignton|England|GB|50.44|-3.57
Rosales|Ilocos|PH|15.89|120.63
Lueeyang Chengguanzhen|Shaanxi|CN|33.33|106.15
Tejen|Ahal|TM|37.38|60.51
Gaithersburg|MD|US|39.14|-77.2
Babati|Manyara|TZ|-4.22|35.75
Shorkot|Khyber Pakhtunkhwa|PK|31.91|70.88
Wenling|Zhejiang|CN|28.38|121.38
Chaguanas|Chaguanas|TT|10.52|-61.42
Buldana|Maharashtra|IN|20.53|76.18
Montemorelos|Nuevo Leon|MX|25.19|-99.83
Omidiyeh|Khuzestan|IR|30.76|49.7
Liepaja|Liepaja|LV|56.5|21.01
Huajing|Shanghai|CN|31.12|121.45
Dhenkanal|Odisha|IN|20.66|85.6
Ezza-Ohu|Ebonyi State|NG|6.44|8.08
Ixtapa-Zihuatanejo|Guerrero|MX|17.64|-101.55
Rossendale|England|GB|53.68|-2.28
Fuqing|Fujian|CN|25.73|119.37
Urun-Islampur|Maharashtra|IN|17.05|74.27
Caohe|Hubei|CN|30.23|115.43
Eskilstuna|Soedermanland|SE|59.37|16.51
Jacksonville|NC|US|34.75|-77.43
Kiyosu|Aichi|JP|35.22|136.83
Kostyantynivka|Donetsk|UA|48.53|37.71
Gaoliu|Shandong|CN|36.8|118.5
Gopalganj|Bihar|IN|26.47|84.44
City of Isabela|Autonomous Region in Muslim Mindanao|PH|6.7|121.97
Breu Branco|Para|BR|-4|-49.51
Bongaigaon|Assam|IN|26.48|90.56
Xinzhou|Hainan|CN|19.71|109.31
Zadar|Zadar|HR|44.12|15.23
Sangamner|Maharashtra|IN|19.57|74.21
San Luis|Santiago de Cuba Province|CU|20.19|-75.85
Caicara del Orinoco|Bolivar|VE|7.64|-66.17
Pingzhuang|Inner Mongolia|CN|42.04|119.29
South San Francisco|CA|US|37.65|-122.41
Sousa|Paraiba|BR|-6.76|-38.23
Kstovo|Nizhny Novgorod Oblast|RU|56.15|44.2
Shiojiri|Nagano|JP|36.1|137.97
Lippstadt|North Rhine-Westphalia|DE|51.67|8.34
Oum el Bouaghi|Oum el Bouaghi|DZ|35.88|7.11
Tomaszow Mazowiecki|Lodz Voivodeship|PL|51.53|20.01
Tabatinga|Amazonas|BR|-4.23|-69.94
Tianliu|Shandong|CN|37|118.78
Minchinabad|Punjab|PK|30.16|73.57
Lushar|Qinghai|CN|36.48|101.56
OEdemis|Izmir Province|TR|38.23|27.97
Koepenick|State of Berlin|DE|52.45|13.57
Wanggou|Jiangsu|CN|34.67|116.49
Fengkou|Hubei|CN|30.08|113.33
Nea Ionia|Attica|GR|38.04|23.76
Haveri|Karnataka|IN|14.79|75.4
Dolores Hidalgo|Guanajuato|MX|21.16|-100.93
Shajing Town|Guangdong|CN|22.74|113.81
Kenner|LA|US|29.99|-90.24
Melati|Yogyakarta|ID|-7.73|110.37
Santa Cruz Xoxocotlan|Oaxaca|MX|17.03|-96.74
Aalen|Baden-Wurttemberg|DE|48.84|10.09
Washington|England|GB|54.9|-1.52
Jackson Heights|NY|US|40.76|-73.89
Saint-Nazaire|Pays de la Loire|FR|47.28|-2.22
Fukutsu|Fukuoka|JP|33.78|130.49
Przemysl|Subcarpathia|PL|49.78|22.77
Estepona|Andalusia|ES|36.43|-5.15
Nunukan|North Kalimantan|ID|4.14|117.65
Mannargudi|Tamil Nadu|IN|10.67|79.45
Dinslaken|North Rhine-Westphalia|DE|51.56|6.74
Nizhyn|Chernihiv Oblast|UA|51.05|31.89
Rockville|MD|US|39.08|-77.15
Liuhe|Jilin|CN|42.28|125.75
Jackson|TN|US|35.61|-88.81
Embu-Guacu|Sao Paulo|BR|-23.83|-46.81
Targoviste|Dambovita County|RO|44.93|25.46
Lincoln Park|IL|US|41.92|-87.65
Kashima-shi|Ibaraki|JP|35.97|140.64
Abu al Matamir|Beheira|EG|30.91|30.17
Yuba City|CA|US|39.14|-121.62
Hanyin Chengguanzhen|Shaanxi|CN|32.89|108.5
Tataouine|Tataouine|TN|32.93|10.45
Jhalawar|Rajasthan|IN|24.6|76.16
Solna|Stockholm|SE|59.36|18
Aleksin|Tula Oblast|RU|54.5|37.07
Portland|ME|US|43.66|-70.26
Sidi Aissa|M'Sila|DZ|35.89|3.77
Palo Alto|CA|US|37.44|-122.14
Saiki|Oita|JP|32.95|131.9
Wacheng Neighborhood|Henan|CN|33.78|114.52
Seinaejoki|South Ostrobothnia|FI|62.79|22.83
Tarn Taran|Punjab|IN|31.45|74.93
General Pico|La Pampa|AR|-35.66|-63.76
Neuwied|Rheinland-Pfalz|DE|50.43|7.47
Ferrol|Galicia|ES|43.48|-8.23
Casas Adobes|AZ|US|32.32|-111
Phuc Loi|Hanoi|VN|21.05|105.93
Bajos de Haina|San Cristobal|DO|18.42|-70.03
Point Cook|Victoria|AU|-37.91|144.75
Marysville|WA|US|48.05|-122.18
Duoba|Qinghai|CN|36.66|101.53
Siddipet|Telangana|IN|18.1|78.85
Unna|North Rhine-Westphalia|DE|51.54|7.69
Shaozhuang|Shandong|CN|36.75|118.32
Dambulla|Central Province|LK|7.86|80.65
Trang|Trang|TH|7.56|99.61
Bani|Peravia|DO|18.28|-70.33
Sayhat|Eastern Province|SA|26.48|50.05
Tepi|South West Ethiopia Peoples' Region|ET|7.2|35.45
Parnas|Leningradskaya Oblast'|RU|60.07|30.35
Bakixanov|Baki|AZ|40.42|49.97
Korabelna Storona|Sevastopol City|UA|44.61|33.54
Chiyoda|Tokyo|JP|35.68|139.75
Karlskrona|Blekinge|SE|56.16|15.59
Dinalupihan|Central Luzon|PH|14.88|120.45
Bellampalli|Telangana|IN|19.06|79.49
Focsani|Vrancea|RO|45.7|27.18
South Jordan|UT|US|40.56|-111.93
Santa Cruz|Central Luzon|PH|15.77|119.91
Tailai|Heilongjiang|CN|46.39|123.41
Lishi|Chongqing|CN|29.08|106.26
Quartu Sant'Elena|Sardinia|IT|39.23|9.25
La Mohammedia|Tunis Governorate|TN|36.67|10.16
Jidd Hafs|Manama|BH|26.22|50.55
Chengyang|Shandong|CN|35.58|118.83
Aluche|Madrid|ES|40.39|-3.76
Sanchazi|Jilin|CN|42.08|126.6
Fort McMurray|Alberta|CA|56.73|-111.38
Kurihara|Miyagi|JP|38.75|141
Daxu|Jiangsu|CN|34.28|117.55
Oshkosh|WI|US|44.02|-88.54
Ramos Arizpe|Coahuila|MX|25.54|-100.95
Aflao|Volta|GH|6.12|1.19
Qaraqash|Xinjiang|CN|37.27|79.73
Barbil|Odisha|IN|22.1|85.38
Taihe|Chongqing|CN|30.1|106.05
Koratla|Telangana|IN|18.82|78.71
North Little Rock|AR|US|34.77|-92.27
Lianyuan|Hunan|CN|27.69|111.66
Goba|Oromiya|ET|7.02|39.98
Stalowa Wola|Subcarpathia|PL|50.58|22.05
Mansehra|Khyber Pakhtunkhwa|PK|34.33|73.2
Sokaraja|Central Java|ID|-7.46|109.29
Camaqua|Rio Grande do Sul|BR|-30.85|-51.81
Smila|Cherkasy|UA|49.23|31.88
Bayside|NY|US|40.77|-73.78
Bununka Kunda|Banjul|GM|13.43|-16.69
Wuxi|Hunan|CN|26.58|111.86
Vicalvaro|Madrid|ES|40.4|-3.6
Folkestone|England|GB|51.08|1.17
Qipan|Jiangsu|CN|34.24|118.22
Plauen|Saxony|DE|50.5|12.14
Napier|Hawke's Bay Region|NZ|-39.49|176.91
San Antonio del Tachira|Tachira|VE|7.81|-72.44
Rishikesh|Uttarakhand|IN|30.11|78.29
Kungur|Perm Krai|RU|57.41|56.97
Kituku|Tanganyika|CD|-7.58|30.21
Castelldefels|Catalonia|ES|41.28|1.97
Goyerkata|West Bengal|IN|26.7|89.03
Klintsy|Bryansk Oblast|RU|52.76|32.24
Togane|Chiba|JP|35.55|140.37
Tangxiang|Chongqing|CN|29.7|105.72
Neryungri|Sakha|RU|56.66|124.72
Huinan|Jilin|CN|42.62|126.26
Bayonne|NJ|US|40.67|-74.11
Brixton|England|GB|51.47|-0.11
Hounslow|England|GB|51.47|-0.36
Besbes|El Tarf|DZ|36.7|7.85
Eagan|MN|US|44.8|-93.17
Beimeng|Shandong|CN|36.6|119.5
Leninogorsk|Tatarstan Republic|RU|54.6|52.45
Cataguases|Minas Gerais|BR|-21.39|-42.7
Bergen op Zoom|North Brabant|NL|51.49|4.29
Delray Beach|FL|US|26.46|-80.07
Algueirao|Lisbon|PT|38.8|-9.34
Loures|Lisbon|PT|38.83|-9.17
Sosnovka|St.-Petersburg|RU|60.02|30.35
Rajin|Rason|KP|42.26|130.28
Granby|Quebec|CA|45.4|-72.73
Marondera|Mashonaland East Province|ZW|-18.19|31.55
Gama|Bengo|AO|-8.57|13.48
Luoyang|Fujian|CN|24.96|118.68
Mandamarri|Telangana|IN|18.97|79.47
Jesus Maria|Lima region|PE|-12.07|-77.04
Muling|Heilongjiang|CN|44.92|130.52
Viladecans|Catalonia|ES|41.31|2.01
Castellammare di Stabia|Campania|IT|40.7|14.49
Cheria|Tebessa|DZ|35.27|7.75
Kasungu|Central Region|MW|-13.03|33.48
Qionghu|Hunan|CN|28.84|112.36
I'zaz|Aleppo|SY|36.59|37.05
Thai Hoa|Nghe An Province|VN|18.92|104.97
Camucuio|Namibe|AO|-14.11|13.24
Gamping Lor|Yogyakarta|ID|-7.8|110.33
Nikki|Borgou|BJ|9.94|3.21
Tanjong Malim|Perak|MY|3.68|101.52
Oued Lill|Manouba|TN|36.83|10.04
Beruniy|Karakalpakstan|UZ|41.69|60.75
Huanan|Heilongjiang|CN|46.24|130.55
Tissemsilt|Tissemsilt|DZ|35.61|1.81
Wamena|Highland Papua|ID|-4.1|138.95
Gukovo|Rostov|RU|48.05|39.93
Sagunto|Valencia|ES|39.68|-0.27
Moron|Ciego de Avila Province|CU|22.11|-78.63
Liberdade|Sao Paulo|BR|-23.56|-46.63
Puliyankudi|Tamil Nadu|IN|9.17|77.4
Zamosc|Lublin|PL|50.72|23.25
Xiaolingwei|Jiangsu|CN|32.03|118.85
Ambilobe|Diana|MG|-13.2|49.05
Johnson City|TN|US|36.31|-82.35
Kitamoto|Saitama|JP|36.03|139.54
Gwa|Rakhine|MM|17.59|94.58
Turayf|Northern Borders Region|SA|31.67|38.66
Calapan|Mimaropa|PH|13.41|121.18
Johor Jaya|Johor|MY|1.54|103.81
Kherson|Kherson|UA|46.64|32.61
Ganshui|Chongqing|CN|28.74|106.71
Dale City|VA|US|38.64|-77.31
Namyang-nodongjagu|North Hamgyong|KP|42.95|129.86
Silvan|Diyarbakir Province|TR|38.14|41.01
Salgueiro|Pernambuco|BR|-8.07|-39.12
Lesosibirsk|Krasnoyarsk Krai|RU|58.24|92.48
Cedar Park|TX|US|30.51|-97.82
Jablah|Latakia|SY|35.36|35.93
Waterfront Communities-The Island|Ontario|CA|43.63|-79.38
Niitsu-honcho|Niigata|JP|37.8|139.12
Lahat|South Sumatra|ID|-3.79|103.54
Tanabe|Kyoto|JP|34.82|135.77
Rotorua|Bay of Plenty|NZ|-38.14|176.25
Durame|Central Ethiopia Regional State|ET|7.23|37.88
Yaoji|Jiangsu|CN|34.07|117.82
Qiantang|Chongqing|CN|30.18|106.32
Vilanova i la Geltru|Catalonia|ES|41.22|1.73
Mengyin|Shandong|CN|35.71|117.93
Parkchester|NY|US|40.84|-73.86
Palin|Escuintla|GT|14.4|-90.7
Lichtenburg|North West|ZA|-26.15|26.16
Tatabanya|Komarom-Esztergom|HU|47.59|18.38
Atascocita|TX|US|30|-95.18
Jietou|Yunnan|CN|25.43|98.65
Saint Cloud|MN|US|45.56|-94.16
Ellicott City|MD|US|39.27|-76.8
Xiangcheng|Henan|CN|33.85|113.49
Palasa|Andhra Pradesh|IN|18.77|84.41
Bayiji|Jiangsu|CN|34.27|117.68
Finchley|England|GB|51.6|-0.2
Laguna Niguel|CA|US|33.52|-117.71
Polewali|West Sulawesi|ID|-3.43|119.34
Chegutu|Mashonaland West|ZW|-18.13|30.14
Myongch'on|North Hamgyong|KP|41.07|129.43
Saint Charles|MO|US|38.78|-90.48
Uniao dos Palmares|Alagoas|BR|-9.16|-36.03
Harlingen|TX|US|26.19|-97.7
Shangkou|Shandong|CN|36.97|118.88
Polevskoy|Sverdlovsk Oblast|RU|56.44|60.19
Pavia|Lombardy|IT|45.19|9.16
Ligezhuang|Shandong|CN|36.36|120.14
Mitoyo|Kagawa|JP|34.21|133.67
Gohana|Haryana|IN|29.14|76.7
Pulivendla|Andhra Pradesh|IN|14.42|78.23
Tu Son|Bac Ninh|VN|21.1|105.97
Wrexham|Wales|GB|53.05|-2.99
Quwaysina|Monufia|EG|30.56|31.16
Chengalpattu|Tamil Nadu|IN|12.69|79.98
Dashitou|Jilin|CN|43.31|128.51
Rovaniemi|Lapland|FI|66.5|25.69
San Ildefonso|Central Luzon|PH|15.08|120.94
San Miguel|Central Luzon|PH|15.14|120.98
Huanghua|Shandong|CN|35.89|119.46
Kedzierzyn-Kozle|Opole Voivodeship|PL|50.35|18.23
Ipixuna do Para|Para|BR|-2.56|-47.49
Tulcea|Tulcea County|RO|45.18|28.81
Qingyang|Shandong|CN|37.5|121.26
Wadgaon Kolhati|Maharashtra|IN|19.84|75.24
Babu|Guangxi|CN|24.42|111.52
Souq Sebt Oulad Nemma|Beni Mellal-Khenifra|MA|32.3|-6.7
Barreirinhas|Maranhao|BR|-2.76|-42.83
Chivilcoy|Buenos Aires|AR|-34.9|-60.02
Ladnun|Rajasthan|IN|27.65|74.4
Ioannina|Epirus|GR|39.66|20.85
Tupa|Sao Paulo|BR|-21.93|-50.51
Wufeng|Taiwan|TW|24.06|120.7
Fleetwood|British Columbia|CA|49.17|-122.8
Bom Jesus da Lapa|Bahia|BR|-13.26|-43.42
Nurabad|Lorestan Province|IR|34.07|47.97
Coroata|Maranhao|BR|-4.13|-44.12
Korba|Nabeul Governorate|TN|36.58|10.86
Basirpur|Punjab|PK|30.58|73.84
Yebaishou|Liaoning|CN|41.4|119.64
Huaiyuan Chengguanzhen|Anhui|CN|32.96|117.17
San Clemente|CA|US|33.43|-117.61
West Lynchburg|VA|US|37.4|-79.18
Iganga|Eastern Region|UG|0.61|33.47
Al Mansurah|Baladiyat ad Dawhah|QA|25.27|51.53
Middletown|NJ|US|40.39|-74.12
Buram|Southern Darfur|SD|10.86|25.16
Dar Kulayb|Southern Governorate|BH|26.07|50.5
Afgooye|Lower Shabeelle|SO|2.14|45.12
Torremolinos|Andalusia|ES|36.62|-4.5
Sattahip|Chon Buri|TH|12.67|100.9
Sokhumi|Abkhazia|GE|43.01|40.99
Supaul|Bihar|IN|26.12|86.6
Ellesmere Port Town|England|GB|53.28|-2.9
Narok|Narok County|KE|-1.08|35.87
Fort Garry South|Manitoba|CA|49.79|-97.16
Firuzabad|Fars|IR|28.84|52.57
Framingham Center|MA|US|42.3|-71.44
Dancheng|Henan|CN|33.64|115.18
Itapoa|Federal District|BR|-15.75|-47.77
Colmar|Grand Est|FR|48.08|7.36
Aran Bidgol|Isfahan|IR|34.06|51.48
Glogow|Lower Silesia|PL|51.66|16.08
Tendo|Yamagata|JP|38.35|140.37
Torquay|England|GB|50.46|-3.53
Baqershahr|Tehran|IR|35.53|51.4
Bianzhuang|Shandong|CN|34.85|118.04
Pankow|State of Berlin|DE|52.57|13.4
Ain M'Lila|Oum el Bouaghi|DZ|36.04|6.57
Meleuz|Bashkortostan Republic|RU|52.96|55.93
Ban Khoan|Bokeo|LA|20.35|100.09
Tultepec|Mexico|MX|19.68|-99.13
Suyangshan|Jiangsu|CN|34.39|117.76
Kumertau|Bashkortostan Republic|RU|52.76|55.79
Gangarampur|West Bengal|IN|25.4|88.53
Ramanathapuram|Tamil Nadu|IN|9.37|78.83
Herten|North Rhine-Westphalia|DE|51.6|7.14
Jagraon|Punjab|IN|30.79|75.47
Schenectady|NY|US|42.81|-73.94
Perai|Penang|MY|5.38|100.38
Urgut Shahri|Samarqand Region|UZ|39.42|67.26
Sinnar|Maharashtra|IN|19.85|74
Hepingjie|Jilin|CN|42.06|126.92
Salama|Baja Verapaz|GT|15.1|-90.32
Bairro Militar|Bissau|GW|11.87|-15.62
Kopargaon|Maharashtra|IN|19.88|74.48
Skhirate|Rabat-Sale-Kenitra|MA|33.85|-7.03
Nioko I|Centre|BF|12.4|-1.44
Tulungagung|East Java|ID|-8.07|111.9
Liuxin|Jiangsu|CN|34.37|117.11
Capelle aan den IJssel|South Holland|NL|51.93|4.58
Gushikawa|Okinawa|JP|26.36|127.87
Caoqiao|Jiangsu|CN|34.34|118.11
Manhica|Maputo Province|MZ|-25.4|32.81
Alipur Duar|West Bengal|IN|26.48|89.52
Belize City|Belize District|BZ|17.5|-88.2
Lala Musa|Punjab|PK|32.7|73.96
Slavyansk-na-Kubani|Krasnodar Krai|RU|45.25|38.12
Longshan|Yunnan|CN|24.6|98.7
Craigieburn|Victoria|AU|-37.6|144.95
Irpin|Kyiv Oblast|UA|50.52|30.24
Villa de Vallecas|Madrid|ES|40.37|-3.6
Januaria|Minas Gerais|BR|-15.48|-44.37
Fengrun|Hebei|CN|39.83|118.14
Pinheiros|Sao Paulo|BR|-23.57|-46.69
Cheyenne|WY|US|41.14|-104.82
Lalmonirhat|Rangpur Division|BD|25.92|89.45
Aquiraz|Ceara|BR|-3.9|-38.39
Tandur|Telangana|IN|17.25|77.58
Ambarawa|Central Java|ID|-7.26|110.4
Ouezzane|Tanger-Tetouan-Al Hoceima|MA|34.8|-5.58
Kalush|Ivano-Frankivsk|UA|49.02|24.37
Villasis|Ilocos|PH|15.9|120.59
Estancia|Sergipe|BR|-11.27|-37.44
Broomfield|CO|US|39.92|-105.09
Ames|IA|US|42.03|-93.62
Park Slope|NY|US|40.67|-73.99
Shawnee|KS|US|39.04|-94.72
Mecheria|Naama|DZ|33.54|-0.28
Maues|Amazonas|BR|-3.38|-57.72
Kunyang|Zhejiang|CN|27.67|120.57
Bezerros|Pernambuco|BR|-8.23|-35.8
Bazar-e Yakawlang|Bamyan|AF|34.74|66.97
Bazarak|Panjshir|AF|35.31|69.52
Ganda|Benguela|AO|-13.02|14.64
Patuakhali|Barisal Division|BD|22.37|90.35
Cricklewood|England|GB|51.56|-0.22
Wrzeszcz|Pomerania|PL|54.38|18.61
King Faisal Military City|Eastern Province|SA|28.45|45.97
Reseda|CA|US|34.2|-118.54
Itaugua|Central Department|PY|-25.39|-57.35
Guildford|British Columbia|CA|49.19|-122.8
Pampatar|Nueva Esparta|VE|11|-63.79
Conway|AR|US|35.09|-92.44
Embu|Embu County|KE|-0.54|37.46
Sumusta al Waqf|Beni Suweif|EG|28.92|30.85
Tianzhuang|Shandong|CN|36.8|119.74
Villa del Rosario|Norte de Santander Department|CO|7.83|-72.47
East Orange|NJ|US|40.77|-74.2
Khulm|Balkh|AF|36.7|67.7
Gitega|Gitega|BI|-3.43|29.92
Sodegaura|Chiba|JP|35.41|140.02
Boditi|South Ethiopia Regional State|ET|6.97|37.87
Busia|Eastern Region|UG|0.47|34.09
Oas|Bicol Region|PH|13.26|123.5
Kolonnawa|Western Province|LK|6.93|79.88
Azul|Buenos Aires|AR|-36.78|-59.86
Loughborough|England|GB|52.77|-1.2
Herford|North Rhine-Westphalia|DE|52.11|8.67
Lingao|Hainan|CN|19.91|109.69
Hita|Oita|JP|33.32|130.94
Portage Park|IL|US|41.96|-87.77
Igarape Miri|Para|BR|-1.98|-48.96
Tongaat|KwaZulu-Natal|ZA|-29.57|31.12
Skokie|IL|US|42.03|-87.73
Shikang|Guangxi|CN|21.77|109.32
Massa|Tuscany|IT|44.04|10.14
Grevenbroich|North Rhine-Westphalia|DE|51.09|6.58
Cair|Grad Skopje|MK|42.02|21.44
Tecate|Baja California|MX|32.57|-116.63
Valverde|Madrid|ES|40.5|-3.68
Dishna|Qena|EG|26.12|32.47
Rechytsa|Homyel' Voblasc'|BY|52.36|30.39
Khatauli|Uttar Pradesh|IN|29.28|77.73
Weimar|Thuringia|DE|50.98|11.33
Bertioga|Sao Paulo|BR|-23.85|-46.14
Hwawon|Daegu|KR|35.8|128.5
Fenggang|Jiangxi|CN|27.55|116.21
Viraraghavapuram|Tamil Nadu|IN|13.07|80.11
Ahlat|Bitlis|TR|38.75|42.48
Asahi|Chiba|JP|35.72|140.65
West Bloomfield Township|MI|US|42.57|-83.38
Tamarac|FL|US|26.21|-80.25
Yendi|Northern|GH|9.44|-0.01
Siuri|West Bengal|IN|23.91|87.53
Raipur|Chittagong|BD|23.04|90.77
Itaberaba|Bahia|BR|-12.53|-40.31
Meulaboh|Aceh|ID|4.14|96.13
Dondo|Cuanza Norte|AO|-9.68|14.43
Malanville|Alibori|BJ|11.87|3.38
Usta Muhammad|Balochistan|PK|28.18|68.04
Youngstown|OH|US|41.1|-80.65
Taunton|England|GB|51.01|-3.1
Tomigusuku|Okinawa|JP|26.19|127.68
Talavera|Central Luzon|PH|15.59|120.92
Chacao|Miranda|VE|10.5|-66.85
Guasdualito|Apure|VE|7.24|-70.73
Crotone|Calabria|IT|39.08|17.13
Lodi|CA|US|38.13|-121.27
La Linea de la Concepcion|Andalusia|ES|36.17|-5.35
North Hollywood|CA|US|34.17|-118.38
Picheng|Jiangsu|CN|34.47|117.97
Greenville|SC|US|34.85|-82.39
Renzhao|Shandong|CN|36.64|120.2
Kotikawatta|Western Province|LK|6.93|79.91
Haskovo|Haskovo|BG|41.93|25.56
Puerto Madryn|Chubut|AR|-42.77|-65.04
Fujioka|Gunma|JP|36.25|139.07
Muncar|East Java|ID|-8.43|114.33
Bina|Madhya Pradesh|IN|24.17|78.19
Koboko|Northern Region|UG|3.41|30.96
Palitana|Gujarat|IN|21.53|71.82
Taman Senawang Indah|Negeri Sembilan|MY|2.69|101.99
Changli|Hebei|CN|39.71|119.16
Yanagawa|Fukuoka|JP|33.17|130.4
Afragola|Campania|IT|40.92|14.31
Preaek Prasab|Kratie|KH|12.35|106.04
Itamaraju|Bahia|BR|-17.04|-39.53
Aksehir|Konya|TR|38.36|31.42
Sahuayo de Morelos|Michoacan|MX|20.06|-102.72
Celina|TX|US|33.32|-96.78
Chaumu|Rajasthan|IN|27.17|75.72
Bandar Seri Begawan|Brunei-Muara District|BN|4.89|114.94
Kaihua|Yunnan|CN|23.37|104.28
Yunmeng Chengguanzhen|Hubei|CN|31.06|113.77
Tikhoretsk|Krasnodar Krai|RU|45.85|40.12
Gelang Patah|Johor|MY|1.45|103.59
Bantul|Yogyakarta|ID|-7.89|110.33
Waterlooville|England|GB|50.88|-1.03
Yangzhou|Shaanxi|CN|33.22|107.54
Sandefjord|Vestfold|NO|59.13|10.22
Imaichi|Tochigi|JP|36.72|139.68
Rossosh'|Voronezh Oblast|RU|51.12|38.51
Montenegro|Rio Grande do Sul|BR|-29.69|-51.46
Maison Blanche|Ile-de-France|FR|48.83|2.35
Gimbi|Oromiya|ET|9.17|35.83
Sheptytskyi|Lviv|UA|50.39|24.24
Tamana|Kumamoto|JP|32.95|130.57
Enrique B. Magalona|Western Visayas|PH|10.88|122.98
Kaposvar|Somogy County|HU|46.37|17.8
Mansfield|TX|US|32.56|-97.14
Halol|Gujarat|IN|22.5|73.47
T'aet'an-up|South Hwanghae|KP|38.09|125.3
Taloqan|Takhar|AF|36.74|69.53
Ongjin|South Hwanghae|KP|37.93|125.36
Punta Alta|Buenos Aires|AR|-38.88|-62.08
Kodar|Telangana|IN|17|79.97
Tuapse|Krasnodar Krai|RU|44.1|39.08
Alba Iulia|Alba County|RO|46.07|23.58
Kerpen|North Rhine-Westphalia|DE|50.87|6.7
Skanes|Monastir Governorate|TN|35.77|10.79
Santa Cruz|CA|US|36.97|-122.03
Pico Rivera|CA|US|33.98|-118.1
Bangarda Chhota|Madhya Pradesh|IN|22.74|75.81
Tshela|Bas-Congo|CD|-5|12.95
Madera|CA|US|36.96|-120.06
Vacaria|Rio Grande do Sul|BR|-28.51|-50.93
Qinggang|Heilongjiang|CN|46.7|126.09
Uga|Anambra|NG|5.94|7.08
Fria|Boke Region|GN|10.37|-13.58
Tadepalle|Andhra Pradesh|IN|16.48|80.6
Koulikoro|Koulikoro|ML|12.86|-7.56
Tirupattur|Tamil Nadu|IN|12.49|78.57
Janesville|WI|US|42.68|-89.02
Surubim|Pernambuco|BR|-7.83|-35.75
Ali Mendjeli|Constantine|DZ|36.25|6.57
Boryspil|Kyiv Oblast|UA|50.35|30.95
West Des Moines|IA|US|41.58|-93.71
Villa Elisa|Central Department|PY|-25.37|-57.59
Aleksandrov|Vladimir Oblast|RU|56.4|38.71
Narutocho-mitsuishi|Tokushima|JP|34.2|134.61
Santiago|Cuzco Department|PE|-13.53|-71.98
Sibi|Balochistan|PK|29.54|67.88
Molina de Segura|Murcia|ES|38.05|-1.21
Ihnasiyah|Beni Suweif|EG|29.09|31.02
Mutengene|South-West|CM|4.09|9.31
Chinnachowk|Andhra Pradesh|IN|14.48|78.84
Bishnupur|West Bengal|IN|23.07|87.32
Paterna|Valencia|ES|39.5|-0.44
Amur|Telangana|IN|18.79|78.28
Palaio Faliro|Attica|GR|37.93|23.7
Wik'ro|Tigray|ET|13.8|39.6
Kotlovka|Moscow|RU|55.66|37.6
Polomolok|Soccsksargen|PH|6.22|125.06
Ensenada|Buenos Aires|AR|-34.86|-57.91
Baheri|Uttar Pradesh|IN|28.77|79.5
Nawalgarh|Rajasthan|IN|27.85|75.27
Paranoa|Federal District|BR|-15.78|-47.78
Montebello|CA|US|34.01|-118.11
Anaiyur|Tamil Nadu|IN|9.96|78.11
Camocim|Ceara|BR|-2.9|-40.84
Kunnamkulam|Kerala|IN|10.65|76.07
Tulangan Utara|East Java|ID|-7.47|112.65
Bognor Regis|England|GB|50.78|-0.68
Ambanja|Diana|MG|-13.67|48.45
Colon|Matanzas Province|CU|22.72|-80.9
Raghogarh|Madhya Pradesh|IN|24.44|77.2
San Antonio de Los Altos|Miranda|VE|10.39|-66.95
Tohana|Haryana|IN|29.71|75.9
Kangar|Perlis|MY|6.44|100.2
Valence|Auvergne-Rhone-Alpes|FR|44.93|4.91
Newtownabbey|Northern Ireland|GB|54.66|-5.91
Cosenza|Calabria|IT|39.3|16.25
Quimper|Brittany|FR|48|-4.1
Pateros|National Capital Region|PH|14.54|121.07
San Pedro de Copan|Copan Department|HN|14.62|-88.87
Thanh Pho Uong Bi|Quang Ninh|VN|21.03|106.77
Dengbu|Jiangxi|CN|28.21|116.82
Pindi Gheb|Punjab|PK|33.24|72.26
Piripiri|Piaui|BR|-4.27|-41.78
Machakos|Machakos County|KE|-1.52|37.27
Kulai|Johor|MY|1.66|103.6
Fulda|Hesse|DE|50.55|9.68
Yangcun|Tianjin|CN|39.36|117.06
Zhicheng|Zhejiang|CN|31.01|119.91
Shendi|River Nile|SD|16.69|33.43
Magong|Taiwan|TW|23.57|119.59
Mpika|Muchinga|ZM|-11.83|31.45
Boke|Boke Region|GN|10.93|-14.29
Georgetown|TX|US|30.63|-97.68
Mangai|Kwilu|CD|-4.02|19.53
As Safirah|Aleppo|SY|36.08|37.37
Lulou|Jiangsu|CN|34.72|116.77
Hull|Quebec|CA|45.43|-75.71
'Alemaya|Oromiya|ET|9.39|42.01
Bongor|Mayo-Kebbi Est|TD|10.28|15.37
Kanchanaburi|Kanchanaburi|TH|14|99.55
Jatani|Odisha|IN|20.16|85.71
Chokwe|Gaza Province|MZ|-24.53|32.98
Alpharetta|GA|US|34.08|-84.29
Fujiidera|Osaka|JP|34.57|135.6
Arni|Tamil Nadu|IN|12.67|79.29
Genk|Flanders|BE|50.97|5.5
Shimodate|Ibaraki|JP|36.3|139.98
Yambol|Yambol|BG|42.48|26.5
Chik Ballapur|Karnataka|IN|13.44|77.73
Kilju|North Hamgyong|KP|40.96|129.33
Lorain|OH|US|41.45|-82.18
Baihecun|Guangxi|CN|22.11|107.24
Dedougou|Boucle du Mouhoun|BF|12.46|-3.46
Bowling Green|KY|US|36.99|-86.44
Nong Khai|Nong Khai|TH|17.88|102.74
Guanyin|Sichuan|CN|29.1|104.39
Flatlands|NY|US|40.62|-73.93
Dundalk|MD|US|39.25|-76.52
Capao da Canoa|Rio Grande do Sul|BR|-29.75|-50.01
New Halfa|Kassala|SD|15.33|35.6
Dormagen|North Rhine-Westphalia|DE|51.1|6.83
Zarechnyy|Penza Oblast|RU|53.2|45.19
Uzice|Central Serbia|RS|43.86|19.85
Buckley|Wales|GB|53.17|-3.08
Mabai|Yunnan|CN|23.01|104.45
Benevides|Para|BR|-1.36|-48.24
Leszno|Greater Poland|PL|51.84|16.57
Bergheim|North Rhine-Westphalia|DE|50.96|6.64
Nago|Okinawa|JP|26.62|127.99
El Mgarsa|Medenine Governorate|TN|33.82|10.99
Ganta|Nimba|LR|7.24|-8.98
Jelutong|Penang|MY|5.39|100.32
Samut Sakhon|Samut Sakhon|TH|13.55|100.27
Eden Prairie|MN|US|44.85|-93.47
Jitra|Kedah|MY|6.27|100.42
Slatina|Olt|RO|44.43|24.37
North Bergen|NJ|US|40.8|-74.01
Zayed City|Abu Dhabi|AE|23.65|53.71
Pittwater|New South Wales|AU|-33.67|151.3
Most|Usti nad Labem Region|CZ|50.5|13.64
Korydallos|Attica|GR|37.98|23.65
Great Yarmouth|England|GB|52.61|1.73
Buin|Santiago Metropolitan|CL|-33.73|-70.74
El Prat de Llobregat|Catalonia|ES|41.33|2.09
Nanlong|Sichuan|CN|31.35|106.06
Mitcham|England|GB|51.4|-0.17
Dhubri|Assam|IN|26.02|89.99
Florence-Graham|CA|US|33.97|-118.24
Youxi|Chongqing|CN|29.21|106.14
Waltham|MA|US|42.38|-71.24
Borsad|Gujarat|IN|22.41|72.9
Budapest XX. keruelet|Budapest|HU|47.44|19.1
Feltham|England|GB|51.45|-0.41
Siddharthanagar|Lumbini Province|NP|27.5|83.45
Garbsen|Lower Saxony|DE|52.42|9.6
Zagne|Montagnes|CI|6.21|-7.48
Pavlovo|Nizhny Novgorod Oblast|RU|55.97|43.09
Margate|England|GB|51.38|1.39
Githunguri|Kiambu County|KE|-1.06|36.78
Githunguri|Machakos County|KE|-1.3|36.99
Kenge|Bas-Congo|CD|-5.77|13.66
Mercedes|Buenos Aires|AR|-34.65|-59.43
West Hartford|CT|US|41.76|-72.74
Kelaa Kebira|Sousse Governorate|TN|35.87|10.54
Ojima|Tokyo|JP|35.69|139.83
Mila|Mila|DZ|36.45|6.26
Padre Hurtado|Santiago Metropolitan|CL|-33.57|-70.81
Pohja-Tallinn|Harjumaa|EE|59.45|24.7
Cajazeiras|Paraiba|BR|-6.89|-38.56
Buduburam|Central|GH|5.52|-0.48
Gorno-Altaysk|Altai|RU|51.96|85.92
Changcheng|Shandong|CN|36.09|119.45
Shanwang|Shandong|CN|36.55|118.71
Lugano|Ticino|CH|46.01|8.96
Gadwal|Telangana|IN|16.24|77.8
Kusadasi|Aydin|TR|37.86|27.26
Tetovo|Tetovo|MK|42.01|20.97
Hod HaSharon|Central District|IL|32.16|34.89
Zory|Silesia|PL|50.05|18.7
Godean|Yogyakarta|ID|-7.77|110.29
Rogers|AR|US|36.33|-94.12
Medicine Hat|Alberta|CA|50.04|-110.68
Lushnje|Fier County|AL|40.94|19.7
Qurayyat|Muscat|OM|23.26|58.92
Fredericton|New Brunswick|CA|45.95|-66.67
Acarau|Ceara|BR|-2.89|-40.12
Piduguralla|Andhra Pradesh|IN|16.48|79.89
Melipilla|Santiago Metropolitan|CL|-33.69|-71.22
Novaya Balakhna|Nizhny Novgorod Oblast|RU|56.49|43.6
Limon|Limon Province|CR|9.99|-83.04
Collado-Villalba|Madrid|ES|40.64|-4
Botou|Hebei|CN|38.07|116.57
Orion|Central Luzon|PH|14.62|120.58
Uiwang|Gyeonggi-do|KR|37.37|126.95
Vaslui|Vaslui County|RO|46.63|27.73
Carol City|FL|US|25.94|-80.25
Pubal|Gyeonggi-do|KR|37.29|127.51
Agnibilekrou|Comoe District|CI|7.13|-3.2
Liuku|Yunnan|CN|25.85|98.86
Los Andes|Valparaiso|CL|-32.83|-70.6
Florida|Camaguey|CU|21.53|-78.23
Kelibia|Nabeul Governorate|TN|36.85|11.09
Baoqing|Heilongjiang|CN|46.32|132.19
Urla|Izmir Province|TR|38.32|26.76
Horad Zhodzina|Minsk|BY|54.1|28.33
Nkwerre|Imo State|NG|5.76|7.1
Mong Kok|Yau Tsim Mong District|HK|22.32|114.17
Al Bajur|Monufia|EG|30.43|31.04
Shizhai|Jiangsu|CN|34.81|116.64
Halton Hills|Ontario|CA|43.64|-79.93
Portel|Para|BR|-1.94|-50.82
Encinitas|CA|US|33.04|-117.29
Sheikhpura|Bihar|IN|25.14|85.84
Jinggou|Shandong|CN|36.28|119.55
Mahdasht|Tehran|IR|35.73|50.81
Auchi|Edo State|NG|7.07|6.26
Belchatow|Lodz Voivodeship|PL|51.37|19.36
Graaff Reinet|Eastern Cape|ZA|-32.25|24.53
Campo Bom|Rio Grande do Sul|BR|-29.68|-51.05
Sirsi|Karnataka|IN|14.62|74.84
Nipani|Maharashtra|IN|16.4|74.38
Sorgun|Yozgat|TR|39.81|35.19
Fanlou|Jiangsu|CN|34.48|116.85
Nasugbu|Calabarzon|PH|14.07|120.63
Brighouse-City Centre|British Columbia|CA|49.17|-123.13
Pueblo Nuevo|Madrid|ES|40.43|-3.64
Kannur|Kerala|IN|11.87|75.36
East Village|NY|US|40.73|-73.99
Tagajo-shi|Miyagi|JP|38.3|141
Butare|Southern Province|RW|-2.6|29.74
Trnava|Trnava Region|SK|48.38|17.59
Randers|Central Jutland|DK|56.46|10.04
Moknine|Monastir Governorate|TN|35.63|10.9
Qingshuping|Hunan|CN|27.38|112.02
Caltanissetta|Sicily|IT|37.49|14.06
Ashford|England|GB|51.15|0.87
Haverhill|MA|US|42.78|-71.08
Changle|Guangxi|CN|21.83|109.42
Sumbawa Besar|West Nusa Tenggara|ID|-8.49|117.42
Gus'-Khrustal'nyy|Vladimir Oblast|RU|55.61|40.65
Pesqueira|Pernambuco|BR|-8.36|-36.7
Bari|Rajasthan|IN|26.65|77.62
Jupiter|FL|US|26.93|-80.09
Nokha|Rajasthan|IN|27.56|73.47
Santa Lucia|San Juan|AR|-31.54|-68.5
Dovzhansk|Luhansk|UA|48.08|39.65
Puerto Penasco|Sonora|MX|31.32|-113.54
Buynaksk|Dagestan|RU|42.82|47.13
Tiquipaya|Cochabamba|BO|-17.34|-66.22
Semporna|Sabah|MY|4.48|118.61
Cubuk|Ankara|TR|40.24|33.03
Krasnoturinsk|Sverdlovsk Oblast|RU|59.77|60.21
Council Bluffs|IA|US|41.26|-95.86
Phitsanulok|Phitsanulok|TH|16.82|100.26
Belebey|Bashkortostan Republic|RU|54.11|54.12
Pedro Leopoldo|Minas Gerais|BR|-19.62|-44.04
Nyunzu|Tanganyika|CD|-5.96|28.02
Wellington|FL|US|26.66|-80.24
Sale|England|GB|53.43|-2.32
Vinukonda|Andhra Pradesh|IN|16.05|79.74
Tonypandy|Wales|GB|51.62|-3.46
Miaojie|Yunnan|CN|25.31|100.28
Kaitong|Jilin|CN|44.81|123.08
West Coon Rapids|MN|US|45.16|-93.35
Colon|Tachira|VE|8.03|-72.26
Zhangjiachuan|Gansu|CN|34.99|106.21
Drancy|Ile-de-France|FR|48.93|2.45
Pingnan|Guangxi|CN|23.54|110.39
Acton|England|GB|51.51|-0.28
Phalia|Punjab|PK|32.43|73.58
Kosong|Gangwon-do|KR|38.38|128.47
Ntoum|Estuaire|GA|0.39|9.76
Shiroi|Chiba|JP|35.8|140.07
North Miami|FL|US|25.89|-80.19
Pervomaysk|Mykolaiv|UA|48.04|30.85
Noisy-le-Grand|Ile-de-France|FR|48.85|2.56
Fochville|North West|ZA|-26.49|27.49
Renukut|Uttar Pradesh|IN|24.22|83.04
Mohammadia|Mascara|DZ|35.59|0.07
Erd|Pest County|HU|47.39|18.91
Hamilton|OH|US|39.4|-84.56
Deqen|Tibet|CN|29.96|90.72
Villeneuve-d'Ascq|Hauts-de-France|FR|50.62|3.17
San Francisco Tesistan|Jalisco|MX|20.8|-103.48
Songyang|Henan|CN|34.46|113.03
Grao de Murviedro|Valencia|ES|39.64|-0.24
Yucheng|Shandong|CN|34.93|116.47
Benslimane|Casablanca-Settat|MA|33.62|-7.12
North Port|FL|US|27.04|-82.24
Marechal Deodoro|Alagoas|BR|-9.71|-35.9
La Seyne-sur-Mer|Provence-Alpes-Cote d'Azur|FR|43.1|5.88
Dom Eliseu|Para|BR|-4.29|-47.51
Shuikou|Guangdong|CN|23.98|115.9
Tulare|CA|US|36.21|-119.35
Ras Tanura|Eastern Province|SA|26.71|50.07
Kogon Shahri|Bukhara|UZ|39.73|64.55
Carazinho|Rio Grande do Sul|BR|-28.28|-52.79
Nagari|Andhra Pradesh|IN|13.32|79.59
Abepura|Papua|ID|-2.6|140.63
Sopron|Gyor-Moson-Sopron|HU|47.69|16.59
Rzhev|Tver Oblast|RU|56.26|34.33
Coon Rapids|MN|US|45.12|-93.29
Berat|Berat County|AL|40.71|19.95
Chistopol'|Tatarstan Republic|RU|55.37|50.64
Holosiyiv|Kyiv City|UA|50.34|30.55
Shulyavka|Kyiv City|UA|50.45|30.45
Asaka|Andijan Region|UZ|40.64|72.24
Levallois-Perret|Ile-de-France|FR|48.89|2.29
Escada|Pernambuco|BR|-8.36|-35.22
Huaral|Lima region|PE|-11.49|-77.21
Inhulets|Dnipropetrovsk|UA|47.73|33.25
Boituva|Sao Paulo|BR|-23.28|-47.67
Viareggio|Tuscany|IT|43.87|10.25
Nioki|Mai-Ndombe|CD|-2.72|17.69
Chidambaram|Tamil Nadu|IN|11.4|79.69
Tanba|Hyogo|JP|35.16|135.04
Tinongan|Western Visayas|PH|10.21|123.04
Millcreek|UT|US|40.69|-111.88
Shuangyang|Jilin|CN|43.52|125.66
Nianzishan|Heilongjiang|CN|47.51|122.89
La Habra|CA|US|33.93|-117.95
Blaine|MN|US|45.16|-93.23
Dabwali|Haryana|IN|29.95|74.74
Sibsagar|Assam|IN|26.98|94.64
Asakusa|Tokyo|JP|35.72|139.8
Narwana|Haryana|IN|29.6|76.12
Yangambi|Tshopo|CD|0.77|24.44
Tikhvin|Leningradskaya Oblast'|RU|59.64|33.53
Sagua la Grande|Villa Clara Province|CU|22.81|-80.07
Auburn|AL|US|32.61|-85.48
Minglanilla|Central Visayas|PH|10.24|123.8
Okha|Gujarat|IN|22.47|69.07
Kiffa|Assaba|MR|16.62|-11.4
Lar|Fars|IR|27.68|54.34
Floriano|Piaui|BR|-6.77|-43.02
Sanghar|Sindh|PK|26.05|68.95
Korogwe|Tanga|TZ|-5.15|38.48
Downtown Vancouver|British Columbia|CA|49.28|-123.12
Nova Odessa|Sao Paulo|BR|-22.78|-47.3
Lomza|Podlasie|PL|53.18|22.06
Bin Xian|Heilongjiang|CN|45.74|127.46
Kempas|Johor|MY|1.55|103.7
Angyalfoeld|Budapest|HU|47.55|19.08
Meshkin Dasht|Tehran|IR|35.75|50.94
Mizan Teferi|South West Ethiopia Peoples' Region|ET|7|35.59
Erzsebetvaros|Budapest|HU|47.5|19.07
Nani Daman|Dadra and Nagar Haveli and Daman and Diu|IN|20.41|72.83
Seremban 2|Negeri Sembilan|MY|2.69|101.91
Smederevo|Central Serbia|RS|44.66|20.93
gorod Solnetchnogorsk|Moscow Oblast|RU|56.19|36.98
Irun|Basque Country|ES|43.34|-1.79
Lake Elsinore|CA|US|33.67|-117.33
Zhaobaoshan|Zhejiang|CN|29.97|121.69
Hushitai|Liaoning|CN|41.94|123.5
Petrodvorets|St.-Petersburg|RU|59.9|29.8
Kuchaman|Rajasthan|IN|27.15|74.86
Miyoshi|Aichi|JP|35.09|137.09
Nimbahera|Rajasthan|IN|24.62|74.68
Labinsk|Krasnodar Krai|RU|44.64|40.74
Tenkodogo|Centre-Est|BF|11.78|-0.37
Zhangji|Jiangsu|CN|34.14|117.38
Marseille 14|Provence-Alpes-Cote d'Azur|FR|43.34|5.38
Picpus|Ile-de-France|FR|48.84|2.4
Maputsoe|Leribe|LS|-28.89|27.9
Asker|Akershus|NO|59.83|10.44
Huoqiu Chengguanzhen|Anhui|CN|32.35|116.29
Mudu|Jiangsu|CN|31.26|120.52
Zalaegerszeg|Zala County|HU|46.84|16.84
Fengyi|Yunnan|CN|25.58|100.31
Nandu|Guangxi|CN|22.85|110.82
Pisco|Ica|PE|-13.71|-76.21
Siddhapur|Gujarat|IN|23.92|72.37
Bamyan|Bamyan|AF|34.82|67.83
Longfeng|Hubei|CN|30.39|109.51
Taoluo|Shandong|CN|35.27|119.37
Bassar|Kara|TG|9.25|0.78
Moca|Espaillat Province|DO|19.39|-70.52
Zamora|Castille and Leon|ES|41.51|-5.74
Iskitim|Novosibirsk Oblast|RU|54.64|83.3
Kiryat Gat|Southern District|IL|31.61|34.76
Svetlogorsk|Homyel' Voblasc'|BY|52.63|29.74
Sao Miguel dos Campos|Alagoas|BR|-9.78|-36.09
Diphu|Assam|IN|25.84|93.43
Attur|Tamil Nadu|IN|11.59|78.6
Daraw|Aswan|EG|24.41|32.92
Beni Enzar|Oriental|MA|35.26|-2.93
Revda|Sverdlovsk Oblast|RU|56.8|59.94
Long My|Can Tho City|VN|9.68|105.57
Koshi|Kumamoto|JP|32.89|130.78
Lobnya|Moscow Oblast|RU|56.03|37.47
Yingshang Chengguanzhen|Anhui|CN|32.63|116.27
Tempelhof|State of Berlin|DE|52.47|13.4
San Andres Tuxtla|Veracruz|MX|18.45|-95.21
Carmichael|CA|US|38.62|-121.33
Songkhla|Songkhla|TH|7.2|100.6
Kokstad|KwaZulu-Natal|ZA|-30.55|29.42
Kampong Cham|Kampong Cham|KH|11.99|105.46
Scarborough|England|GB|54.28|-0.4
Rayadrug|Andhra Pradesh|IN|14.7|76.85
Xiangzhou|Shandong|CN|36.16|119.42
Yamato-Takada|Nara|JP|34.52|135.75
Morada Nova|Ceara|BR|-5.11|-38.37
Rath|Uttar Pradesh|IN|25.59|79.57
Ngozi|Ngozi|BI|-2.91|29.83
Al Shamkhah City|Abu Dhabi|AE|24.39|54.71
Lakshmipur|Chittagong|BD|22.94|90.83
Yangiyul|Tashkent Region|UZ|41.11|69.05
Yongning|Guangxi|CN|22.76|108.48
Wesel|North Rhine-Westphalia|DE|51.67|6.62
Penapolis|Sao Paulo|BR|-21.42|-50.08
Vyksa|Nizhny Novgorod Oblast|RU|55.32|42.17
Cortazar|Guanajuato|MX|20.48|-100.96
Trikala|Thessaly|GR|39.55|21.77
Kolea|Tipaza|DZ|36.64|2.77
Chambery|Auvergne-Rhone-Alpes|FR|45.57|5.92
Kolding|South Denmark|DK|55.49|9.47
Extremoz|Rio Grande do Norte|BR|-5.71|-35.31
Xinye|Henan|CN|32.53|112.37
Cheruvannur|Kerala|IN|11.19|75.83
Budapest XIX. keruelet|Budapest|HU|47.45|19.15
Ad Dir'iyah|Riyadh Region|SA|24.75|46.54
Dmitrov|Moscow Oblast|RU|56.34|37.52
Ueno-ebisumachi|Mie|JP|34.76|136.13
Sibay|Bashkortostan Republic|RU|52.72|58.67
Faqirwali|Punjab|PK|29.47|73.03
Lishu|Jilin|CN|43.31|124.33
Oroqen Zizhiqi|Inner Mongolia|CN|50.57|123.72
Beja|Beja Governorate|TN|36.73|9.18
Taylor|MI|US|42.24|-83.27
La Fria|Tachira|VE|8.22|-72.25
Alcoy|Valencia|ES|38.71|-0.47
Cayenne|Guyane|GF|4.94|-52.33
Hasuda|Saitama|JP|35.97|139.65
Gaya|Dosso Region|NE|11.88|3.45
Xianju|Zhejiang|CN|28.85|120.73
As Saff|Giza|EG|29.56|31.28
Malaybalay|Northern Mindanao|PH|8.16|125.13
Mora|Far North|CM|11.05|14.14
Porirua|Wellington Region|NZ|-41.13|174.85
Vriddhachalam|Tamil Nadu|IN|11.52|79.32
Korosten|Zhytomyr Oblast|UA|50.95|28.64
Karlstad|Vaermland|SE|59.38|13.5
Nieuwegein|Utrecht|NL|52.03|5.08
Burnsville|MN|US|44.77|-93.28
Tamba|Hyogo|JP|35.17|135.03
Barh|Bihar|IN|25.48|85.71
Jianguang|Jiangxi|CN|28.19|115.78
Monterey Park|CA|US|34.06|-118.12
Widnes|England|GB|53.36|-2.73
Djibo|Sahel|BF|14.1|-1.63
Euclides da Cunha|Bahia|BR|-10.51|-39.02
Kispest|Budapest|HU|47.45|19.14
Issy-les-Moulineaux|Ile-de-France|FR|48.82|2.28
Dongning|Heilongjiang|CN|44.08|131.12
Aketi|Bas-Uele|CD|2.74|23.78
Dashi|Chongqing|CN|30.09|106.22
Vicosa do Ceara|Ceara|BR|-3.56|-41.09
Stryi|Lviv|UA|49.26|23.85
Kempten (Allgaeu)|Bavaria|DE|47.73|10.31
Mdiq|Tanger-Tetouan-Al Hoceima|MA|35.68|-5.33
Abu Hummus|Beheira|EG|31.09|30.31
Castro Valley|CA|US|37.69|-122.09
Mariana|Minas Gerais|BR|-20.38|-43.42
Shahada|Maharashtra|IN|21.55|74.47
Tunasan|Calabarzon|PH|14.38|121.05
Sig|Mascara|DZ|35.53|-0.19
San Salvador Tizatlalli|Mexico|MX|19.26|-99.59
Arrecife|Canary Islands|ES|28.96|-13.55
Savona|Liguria|IT|44.31|8.48
Mushie|Mai-Ndombe|CD|-3.02|16.92
Irvington|NJ|US|40.73|-74.23
Sindelfingen|Baden-Wurttemberg|DE|48.7|9.02
Vyronas|Attica|GR|37.96|23.75
Mojo|Oromiya|ET|8.59|39.12
Neuilly-sur-Seine|Ile-de-France|FR|48.88|2.27
Tianchang|Hebei|CN|38|114.02
Mizusawa|Iwate|JP|39.13|141.13
Dabra|Madhya Pradesh|IN|25.89|78.33
Veenendaal|Utrecht|NL|52.03|5.56
Mateare|Managua Department|NI|12.24|-86.43
La Chorrera|Panama Oeste Province|PA|8.88|-79.78
Kuroiso|Tochigi|JP|36.97|140.05
Barbalha|Ceara|BR|-7.31|-39.3
Schwaebisch Gmuend|Baden-Wurttemberg|DE|48.8|9.8
Rocklin|CA|US|38.79|-121.24
Slawi|Central Java|ID|-6.98|109.14
Gaalkacyo|Mudug|SO|6.77|47.43
Apatity|Murmansk|RU|67.58|33.41
Chichibu|Saitama|JP|35.99|139.08
Kesennuma|Miyagi|JP|38.9|141.58
Caico|Rio Grande do Norte|BR|-6.46|-37.1
Runcorn|England|GB|53.34|-2.73
Barra do Garcas|Mato Grosso|BR|-15.89|-52.26
Udumalaippettai|Tamil Nadu|IN|10.59|77.25
Dembi Dolo|Oromiya|ET|8.53|34.8
Utica|NY|US|43.1|-75.23
Gubat|Bicol Region|PH|12.92|124.12
Dar Naim|Nouakchott North|MR|18.11|-15.93
Xifeng|Liaoning|CN|42.74|124.72
Datong|Anhui|CN|32.62|117.06
Punta de Mata|Monagas|VE|9.69|-63.61
Horsens|Central Jutland|DK|55.86|9.85
Banfield|Buenos Aires|AR|-34.75|-58.39
Malden|MA|US|42.43|-71.07
Biga|Canakkale|TR|40.23|27.24
Hashimoto|Wakayama|JP|34.32|135.62
National City|CA|US|32.68|-117.1
Novoaltaysk|Altai Krai|RU|53.41|83.94
Pecangaan|Central Java|ID|-6.7|110.71
Bury|England|GB|53.6|-2.3
Dewsbury|England|GB|53.69|-1.63
Valjevo|Central Serbia|RS|44.28|19.9
Nanhu|Shandong|CN|35.49|119.35
Yicheng|Hubei|CN|31.7|112.26
Svobodnyy|Amur Oblast|RU|51.37|128.14
Bangor|Northern Ireland|GB|54.66|-5.67
Ban Tha Kham|Bangkok|TH|13.64|100.44
Itoman|Okinawa|JP|26.13|127.67
Felege Neway|South Ethiopia Regional State|ET|6.3|36.88
Villa Poeta Jose Galvez Barrenechea|Lima region|PE|-12.21|-76.91
Sal'sk|Rostov|RU|46.47|41.54
Stupino|Moscow Oblast|RU|54.9|38.07
Fier-Cifci|Fier County|AL|40.72|19.57
Neka|Mazandaran|IR|36.65|53.3
Parit|Perak|MY|4.48|100.92
Kampong Sidam|Kedah|MY|5.53|100.57
Granollers|Catalonia|ES|41.61|2.29
Fano|The Marches|IT|43.84|13.02
Financial District|NY|US|40.71|-74.01
Chinch'on|North Chungcheong|KR|36.86|127.44
Tiptur|Karnataka|IN|13.26|76.48
Sahaswan|Uttar Pradesh|IN|28.07|78.75
Wanparti|Telangana|IN|16.37|78.07
Zeist|Utrecht|NL|52.09|5.23
Sidi Bennour|Casablanca-Settat|MA|32.65|-8.43
Anuradhapura|North Central Province|LK|8.31|80.41
Tarnowskie Gory|Silesia|PL|50.45|18.86
Xiema|Chongqing|CN|29.77|106.37
Buluan|Autonomous Region in Muslim Mindanao|PH|6.72|124.8
Grosseto|Tuscany|IT|42.76|11.11
Kirikhan|Hatay|TR|36.5|36.36
Soroti|Eastern Region|UG|1.71|33.61
Yanliang|Shaanxi|CN|34.66|109.23
Tahe|Heilongjiang|CN|52.32|124.7
Springfield|OR|US|44.05|-123.02
Mbinga|Ruvuma|TZ|-10.93|35.02
Bethesda|MD|US|38.98|-77.1
San Miguel|Puno|PE|-15.48|-70.12
Uyovu|Geita|TZ|-3.28|31.53
Norfolk County|Ontario|CA|42.83|-80.38
Sirhind|Punjab|IN|30.64|76.38
Dayr Mawas|Minya|EG|27.64|30.85
Joso|Ibaraki|JP|36.04|139.96
Erdaojiang|Jilin|CN|41.78|126.03
Aisai|Aichi|JP|35.16|136.73
Terre Haute|IN|US|39.47|-87.41
Bardoli|Gujarat|IN|21.12|73.11
Kolomyia|Ivano-Frankivsk|UA|48.52|25.04
Tartagal|Salta|AR|-22.52|-63.81
Vineland|NJ|US|39.49|-75.03
West Hollywood|FL|US|26.02|-80.18
Prokhladnyy|Kabardino-Balkariya Republic|RU|43.76|44.03
Fort Portal|Western Region|UG|0.66|30.27
Tianpeng|Sichuan|CN|30.99|103.94
Troyes|Grand Est|FR|48.3|4.09
Kertosono|East Java|ID|-7.58|112.1
North Delta|British Columbia|CA|49.17|-122.92
Stodulky|Prague|CZ|50.05|14.32
Monte Mor|Sao Paulo|BR|-22.95|-47.32
Sarandi|Buenos Aires|AR|-34.68|-58.35
Xixiang|Henan|CN|35.16|112.86
Beckenham|England|GB|51.41|-0.03
Yazman|Punjab|PK|29.12|71.74
Seraing|Wallonia|BE|50.58|5.5
San Marcos|Sucre Department|CO|8.66|-75.13
Chicacao|Suchitepeque|GT|14.54|-91.33
El Wak|Mandera County|KE|2.81|40.93
Republica|Sao Paulo|BR|-23.54|-46.64
Gilgil|Nakuru County|KE|-0.5|36.32
Upper Gilgil|Nyandarua County|KE|-0.21|36.27
Shuya|Ivanovo Oblast|RU|56.85|41.39
Shchekino|Tula Oblast|RU|54.01|37.51
Ban Lam Luk Ka|Pathum Thani|TH|13.98|100.78
Towada|Aomori|JP|40.62|141.21
San Marcos|TX|US|29.88|-97.94
Mokameh|Bihar|IN|25.4|85.92
Yaowan|Jiangsu|CN|34.18|118.07
Brentwood|NY|US|40.78|-73.25
Farnborough|England|GB|51.29|-0.76
Bor|Nizhny Novgorod Oblast|RU|56.36|44.07
Givatayim|Tel Aviv|IL|32.07|34.81
Arambagh|West Bengal|IN|22.88|87.78
Lakeville|MN|US|44.65|-93.24
Mujiayingzi|Inner Mongolia|CN|42.12|118.78
West Allis|WI|US|43.02|-88.01
Yame|Fukuoka|JP|33.23|130.65
Poonamalle|Tamil Nadu|IN|13.05|80.11
Tynemouth|England|GB|55.02|-1.43
Akim Oda|Eastern|GH|5.93|-0.99
Dubna|Moscow Oblast|RU|56.74|37.19
Ibitinga|Sao Paulo|BR|-21.76|-48.83
Redmond|WA|US|47.67|-122.12
Motril|Andalusia|ES|36.75|-3.52
Kinokawa|Wakayama|JP|34.27|135.41
Keonjhargarh|Odisha|IN|21.63|85.6
Tacuarembo|Tacuarembo Department|UY|-31.72|-55.98
Dingjia|Chongqing|CN|29.41|106.14
Mene Grande|Zulia|VE|9.85|-70.93
Lokoja|Kogi State|NG|7.8|6.74
Canoga Park|CA|US|34.2|-118.6
Cupertino|CA|US|37.32|-122.03
Bhadravati|Maharashtra|IN|20.1|79.11
Ualog|Western Visayas|PH|10.57|123.39
Langzhong|Sichuan|CN|31.55|105.99
Ciudad Hidalgo|Michoacan|MX|19.69|-100.56
Taylorsville|UT|US|40.67|-111.94
Takaishi|Osaka|JP|34.52|135.43
Liancheng|Fujian|CN|25.72|116.75
Jiangbei|Chongqing|CN|29.73|106.64
Moramanga|Alaotra Mangoro|MG|-18.95|48.23
Bristol|CT|US|41.67|-72.95
Moore|OK|US|35.34|-97.49
Gardena|CA|US|33.89|-118.31
Longgang|Shandong|CN|37.65|120.33
Novo Repartimento|Para|BR|-4.33|-49.8
Petaluma|CA|US|38.23|-122.64
Fethiye|Mugla|TR|36.64|29.13
Bensalem|PA|US|40.1|-74.95
District of Taher|Jijel|DZ|36.77|5.9
Zacapa|Zacapa|GT|14.97|-89.53
Hereford|England|GB|52.06|-2.71
Matera|Basilicate|IT|40.67|16.6
Midelt|Beni Mellal-Khenifra|MA|32.69|-4.75
Grand Junction|CO|US|39.06|-108.55
Taitou|Shandong|CN|37.03|118.63
Swidnica|Lower Silesia|PL|50.84|16.49
Cruz das Almas|Bahia|BR|-12.67|-39.1
Olbia|Sardinia|IT|40.92|9.5
Mangochi|Southern Region|MW|-14.48|35.26
Gushu|Anhui|CN|31.56|118.48
Sanyoonoda|Yamaguchi|JP|34.03|131.16
Panruti|Tamil Nadu|IN|11.78|79.55
Al Burj|Kafr el-Sheikh|EG|31.58|30.98
Fenshui|Chongqing|CN|30.72|108.08
Mirassol|Sao Paulo|BR|-20.82|-49.52
Mirdif|Dubai|AE|25.22|55.41
Casper|WY|US|42.87|-106.31
Monze|Southern Province|ZM|-16.27|27.48
Setia Tropika|Johor|MY|1.55|103.72
Shimotsuke|Tochigi|JP|36.41|139.87
Wujing|Shandong|CN|36.45|118.4
Ilkal|Karnataka|IN|15.96|76.11
Rowlett|TX|US|32.9|-96.56
Vejle|South Denmark|DK|55.71|9.54
Chelm|Lublin|PL|51.14|23.47
Cogan|Central Visayas|PH|10.59|124.02
Kiratpur|Uttar Pradesh|IN|29.51|78.21
Wucheng|Anhui|CN|29.6|118.17
Cristalina|Goias|BR|-16.77|-47.62
Yuxia|Shaanxi|CN|34.06|108.63
Trinidad|Sancti Spiritus Province|CU|21.8|-79.98
Tahara|Aichi|JP|34.67|137.27
Runan|Henan|CN|33|114.35
Parkent|Tashkent Region|UZ|41.29|69.68
Vrindavan|Uttar Pradesh|IN|27.58|77.7
Douane|Nabeul Governorate|TN|36.45|10.76
Kodungallur|Kerala|IN|10.23|76.2
Penedo|Alagoas|BR|-10.29|-36.59
Bandar-e Kangan|Bushehr|IR|27.83|52.06
Vavuniya|Northern Province|LK|8.75|80.5
Ech Chettia|Chlef|DZ|36.2|1.26
Rosenheim|Bavaria|DE|47.86|12.12
Nagakute|Aichi|JP|35.17|137.06
Nedumangad|Kerala|IN|8.6|77
Stroud|England|GB|51.75|-2.2
Gucheng|Shandong|CN|36.95|118.76
Bambang|Cagayan Valley|PH|16.39|121.11
Taozhuang|Shandong|CN|34.85|117.33
Tczew|Pomerania|PL|54.09|18.78
Santo Amaro|Bahia|BR|-12.55|-38.71
Sandaohezi|Xinjiang|CN|44.33|85.62
Pokrovsk|Donetsk|UA|48.28|37.18
Hpakan|Kachin State|MM|25.61|96.31
Abyek|Qazvin Province|IR|36.04|50.53
Sennan|Osaka|JP|34.35|135.27
Laascaanood|Sool|SO|8.48|47.36
Yongbei|Yunnan|CN|26.65|100.78
Halesowen|England|GB|52.45|-2.05
La Mesa|CA|US|32.77|-117.02
Waterford|Munster|IE|52.26|-7.11
Pine Hills|FL|US|28.56|-81.45
Martinez de la Torre|Veracruz|MX|20.07|-97.06
Kuwait City|Al Asimah|KW|29.37|47.97
Melbourne City Centre|Victoria|AU|-37.82|144.97
Zushi|Kanagawa|JP|35.29|139.58
Pavlovskiy Posad|Moscow Oblast|RU|55.78|38.65
Hyuga|Miyazaki|JP|32.42|131.64
Dazeshan|Shandong|CN|36.99|119.92
Bela Vista|Sao Paulo|BR|-23.56|-46.65
Sao Borja|Rio Grande do Sul|BR|-28.66|-56
Saravan|Sistan and Baluchestan|IR|27.37|62.33
Villa Vicente Guerrero|Tlaxcala|MX|19.12|-98.17
Nzagi|Cuanza Norte|AO|-8.39|15.3
Hurlingham|Buenos Aires|AR|-34.59|-58.63
Zhujiajiao|Shanghai|CN|31.11|121.06
Wuzhen|Zhejiang|CN|30.75|120.49
Gamonal|Castille and Leon|ES|42.36|-3.67
Santutxu|Basque Country|ES|43.25|-2.92
Juan-les-Pins|Provence-Alpes-Cote d'Azur|FR|43.57|7.11
Chelsea|England|GB|51.49|-0.17
Bangaon|Bihar|IN|25.87|86.51
Mbale|Vihiga County|KE|0.08|34.72
Nema|Hodh Ech Chargi|MR|16.62|-7.26
Colonia Nativitas|Mexico City|MX|19.38|-99.14
Putra Heights|Selangor|MY|2.99|101.57
Ara Damansara|Selangor|MY|3.12|101.59
Bukit Indah|Johor|MY|1.48|103.66
Faruka|Punjab|PK|31.89|72.41
Sviblovo|Moscow|RU|55.85|37.63
Ostankinskiy|Moscow|RU|55.83|37.62
Bensonhurst|NY|US|40.6|-73.99
Coney Island|NY|US|40.58|-73.99
Rancho Penasquitos|CA|US|32.96|-117.12
Valley Glen|CA|US|34.19|-118.42
Vinhomes Ocean Park|Hanoi|VN|20.99|105.95
Meriden|CT|US|41.54|-72.81
Dai Mo|Hanoi|VN|20.98|105.77
Narsimhapur|Madhya Pradesh|IN|22.95|79.18
Tanay|Calabarzon|PH|14.5|121.28
Obando|Central Luzon|PH|14.71|120.94
Uki|Kumamoto|JP|32.62|130.66
Heroica Caborca|Sonora|MX|30.72|-112.16
Pontiac|MI|US|42.64|-83.29
Temerluh|Pahang|MY|3.45|102.42
Hwasun|Jeollanam-do|KR|35.06|126.99
Ponnur|Andhra Pradesh|IN|16.07|80.55
Acerra|Campania|IT|40.94|14.37
Jiangkou|Fujian|CN|25.49|119.2
Maqin County|Qinghai|CN|34.47|100.24
Limoeiro do Norte|Ceara|BR|-5.15|-38.1
Yamethin|Mandalay Region|MM|20.43|96.14
Kathua|Jammu and Kashmir|IN|32.37|75.53
Port Orange|FL|US|29.14|-81
Merida|Extremadura|ES|38.92|-6.34
Boyolali|Central Java|ID|-7.53|110.6
Hamden|CT|US|41.4|-72.9
Antony|Ile-de-France|FR|48.75|2.3
Jacunda|Para|BR|-4.45|-49.12
North Lakhimpur|Assam|IN|27.24|94.1
Pucheng|Fujian|CN|27.92|118.53
Lakewood|WA|US|47.17|-122.52
Brandenburg an der Havel|Brandenburg|DE|52.42|12.55
Balagtas|Central Luzon|PH|14.82|120.87
Buyeo|Chungcheongnam-do|KR|36.27|126.91
Bang Khae Nuea|Bangkok|TH|13.71|100.39
Masaurhi Buzurg|Bihar|IN|25.35|85.03
Nerkunram|Tamil Nadu|IN|13.06|80.21
Kosai|Shizuoka|JP|34.7|137.52
Fountainebleau|FL|US|25.77|-80.35
Piekary Slaskie|Silesia|PL|50.38|18.93
Itogon|Cordillera|PH|16.36|120.68
Bekescsaba|Bekes County|HU|46.68|21.1
Ruesselsheim am Main|Hesse|DE|49.99|8.42
Zvishavane|Masvingo Province|ZW|-20.33|30.07
Saint Clair Shores|MI|US|42.5|-82.89
Agia Paraskevi|Attica|GR|38.02|23.83
Metu|Oromiya|ET|8.3|35.58
Prachantakham|Prachin Buri|TH|14.06|101.52
Springfield|OH|US|39.92|-83.81
Shegaon|Maharashtra|IN|20.79|76.7
Pampan|Trujillo|VE|9.45|-70.48
Mandideep|Madhya Pradesh|IN|23.08|77.53
Katiola|Vallee du Bandama District|CI|8.14|-5.1
Great Falls|MT|US|47.5|-111.3
Ksar el Boukhari|Medea|DZ|35.89|2.75
Sao Miguel do Guama|Para|BR|-1.63|-47.48
Date|Fukushima|JP|37.82|140.5
Ekpoma|Edo State|NG|6.74|6.14
Pachora|Maharashtra|IN|20.67|75.35
Nag Hammadi|Qena|EG|26.05|32.24
Baimajing|Hainan|CN|19.71|109.22
Tuanbao|Hubei|CN|30.34|109.13
San Cristobal|Artemisa|CU|22.72|-83.06
Den Helder|North Holland|NL|52.96|4.76
Chapel Hill|NC|US|35.91|-79.06
Berlin Koepenick|State of Berlin|DE|52.44|13.58
Molfetta|Apulia|IT|41.2|16.6
Altamira|Tamaulipas|MX|22.39|-97.94
Canyon Country|CA|US|34.42|-118.47
Sengkang|South Sulawesi|ID|-4.13|120.03
Gobichettipalayam|Tamil Nadu|IN|11.45|77.44
Gangoh|Uttar Pradesh|IN|29.78|77.26
Mielec|Subcarpathia|PL|50.29|21.42
Dayr al Balah|Gaza Strip|PS|31.42|34.35
Ferizaj|Ferizaj|XK|42.37|21.16
Shirakawa|Fukushima|JP|37.12|140.26
Itanagar|Arunachal Pradesh|IN|27.09|93.61
Esfarayen|North Khorasan|IR|37.08|57.51
Drummondville|Quebec|CA|45.88|-72.48
Comitancillo|San Marcos|GT|15.09|-91.75
Sonsonate|Sonsonate Department|SV|13.72|-89.72
Wenshang|Shandong|CN|35.73|116.5
Ipira|Bahia|BR|-12.16|-39.74
Moelndal|Vaestra Goetaland|SE|57.66|12.01
Huntington Park|CA|US|33.98|-118.23
Meiganga|Adamaoua|CM|6.52|14.3
La Roche-sur-Yon|Pays de la Loire|FR|46.67|-1.43
Tutoia|Maranhao|BR|-2.76|-42.27
Kurkali Sindh Pakistan|Sindh|PK|25.94|68.82
Chikuma|Nagano|JP|36.53|138.09
Mingshui|Heilongjiang|CN|47.18|125.9
Ogori|Fukuoka|JP|33.39|130.55
Azrou|Fes-Meknes|MA|33.43|-5.22
Galatsi|Attica|GR|38.02|23.75
Lancaster|PA|US|40.04|-76.31
Jaitpur|Haryana|IN|28.51|77.33
Huiqu|Shandong|CN|36.27|119.05
As Salihiyah al Jadidah|Sharqia|EG|30.63|31.94
Narasapur|Andhra Pradesh|IN|16.43|81.7
Cachoeiras de Macacu|Rio de Janeiro|BR|-22.46|-42.65
Coconut Creek|FL|US|26.25|-80.18
Wendo|Sidama Region|ET|6.6|38.42
San Felipe|Valparaiso|CL|-32.75|-70.73
Dhone|Andhra Pradesh|IN|15.4|77.87
Irati|Parana|BR|-25.47|-50.65
Gannan|Heilongjiang|CN|47.92|123.5
Offenburg|Baden-Wurttemberg|DE|48.47|7.94
Craigavon|Northern Ireland|GB|54.45|-6.39
Aboisso|Comoe District|CI|5.47|-3.21
Lamongan|East Java|ID|-7.12|112.42
Panlongcheng Jingji Kaifaqu|Hubei|CN|30.69|114.27
Nabaruh|Dakahlia|EG|31.1|31.3
Leander|TX|US|30.58|-97.85
Mikhaylovsk|Stavropol Kray|RU|45.13|42.03
Rajgarh|Rajasthan|IN|28.64|75.39
Sahagun|Cordoba|CO|8.95|-75.44
Jian'ou|Fujian|CN|27.04|118.32
Idaho Falls|ID|US|43.47|-112.03
Kotlas|Arkhangelskaya|RU|61.26|46.65
Fundacion|Magdalena Department|CO|10.52|-74.19
Veliko Turnovo|Veliko Tarnovo|BG|43.08|25.63
Tashan|Jiangsu|CN|34.34|117.57
San Rafael|CA|US|37.97|-122.53
Jixian|Heilongjiang|CN|46.73|131.13
Hezuo|Gansu|CN|34.99|102.91
Azua|Azua Province|DO|18.45|-70.73
Wanchaq|Cuzco Department|PE|-13.52|-71.97
Chalkida|Central Greece|GR|38.46|23.6
Oltinko'l|Karakalpakstan|UZ|43.07|58.9
Ullal|Karnataka|IN|12.81|74.86
Abadeh|Fars|IR|28.83|53.17
Manaoag|Ilocos|PH|16.04|120.49
Rio Bonito|Rio de Janeiro|BR|-22.71|-42.61
Langenfeld|North Rhine-Westphalia|DE|51.11|6.95
Al Warqaa|Dubai|AE|25.19|55.42
Umm Al Quwain City|Umm Al Quwain|AE|25.56|55.56
Haizhou|Jiangsu|CN|34.58|119.13
Pierrefonds|Quebec|CA|45.46|-73.89
Noblesville|IN|US|40.05|-86.01
Panna|Madhya Pradesh|IN|24.72|80.19
Dilling|Southern Kordofan|SD|12.05|29.65
Longgu|Jiangsu|CN|34.9|116.81
Yigou|Henan|CN|35.81|114.32
Santo Tome|Santa Fe|AR|-31.66|-60.77
Yagoua|Far North|CM|10.34|15.23
Marietta|GA|US|33.95|-84.55
San Francisco|Cordoba|AR|-31.42|-62.08
Taua|Ceara|BR|-6|-40.29
Verkhnyaya Pyshma|Sverdlovsk Oblast|RU|56.97|60.58
Ferencvaros|Budapest|HU|47.48|19.09
As-Suwayda|Suwayda|SY|32.71|36.57
Fairfield|CT|US|41.14|-73.26
Talnakh|Krasnoyarsk Krai|RU|69.49|88.4
Langtoucun|Liaoning|CN|40.04|124.34
Owensboro|KY|US|37.77|-87.11
Jose Rizal|Mimaropa|PH|8.88|117.5
Eastvale|CA|US|33.96|-117.56
Sarpsborg|Ostfold|NO|59.28|11.11
Simpang Renggam|Johor|MY|1.82|103.31
El Palomar|Buenos Aires|AR|-34.62|-58.6
Qiryat Ata|Haifa|IL|32.81|35.11
Acara|Para|BR|-1.96|-48.2
Royal Oak|MI|US|42.49|-83.14
Minami-Soma|Fukushima|JP|37.63|140.98
Camacupa|Bie|AO|-12.02|17.48
Mot'a|Amhara|ET|11.08|37.87
Slutsk|Minsk|BY|53.02|27.54
Gola Gokarannath|Uttar Pradesh|IN|28.08|80.47
Mbera|Hodh Ech Chargi|MR|15.86|-5.79
Zarand|Kerman|IR|30.81|56.56
Petroupolis|Attica|GR|38.04|23.68
Stralsund|Mecklenburg-Vorpommern|DE|54.31|13.08
Brentwood|CA|US|37.93|-121.7
Juruti|Para|BR|-2.15|-56.09
Goz Beida|Sila|TD|12.23|21.41
Gohad|Madhya Pradesh|IN|26.43|78.44
Golpayegan|Isfahan|IR|33.45|50.29
Torbat-e Jam|Razavi Khorasan|IR|35.24|60.62
Fraijanes|Guatemala|GT|14.47|-90.44
Kitahiroshima|Hokkaido|JP|42.98|141.57
Mpanda|Bubanza|BI|-3.17|29.4
Cruz Alta|Rio Grande do Sul|BR|-28.64|-53.61
Xiaoweizhai|Guizhou|CN|26.19|107.51
Baki|Central Java|ID|-7.61|110.78
Cerro de Pasco|Pasco|PE|-10.67|-76.25
Mikhaylovka|Volgograd Oblast|RU|50.06|43.23
Solnechnogorsk|Moscow Oblast|RU|56.18|36.97
Villach|Carinthia|AT|46.61|13.86
Antu|Jilin|CN|43.1|128.91
Benalmadena|Andalusia|ES|36.6|-4.57
Wani|Maharashtra|IN|20.06|78.95
Ardakan|Yazd Province|IR|32.31|54.02
Avan|Yerevan|AM|40.21|44.58
Menzel Bourguiba|Bizerte Governorate|TN|37.15|9.79
Dubuque|IA|US|42.5|-90.66
Wallasey|England|GB|53.42|-3.06
Kamphaeng Phet|Kamphaeng Phet|TH|16.48|99.52
Koga|Fukuoka|JP|33.73|130.47
Comayagua|Comayagua Department|HN|14.46|-87.64
Thiruvarur|Tamil Nadu|IN|10.77|79.64
Upleta|Gujarat|IN|21.74|70.28
Suozhen|Shandong|CN|36.95|118.1
Ishikari|Hokkaido|JP|43.24|141.35
Tessaoua|Maradi Region|NE|13.76|7.99
Cerdanyola del Valles|Catalonia|ES|41.49|2.14
Vinto|Cochabamba|BO|-17.39|-66.32
Kayes|Bouenza|CG|-4.2|13.29
Marseille 12|Provence-Alpes-Cote d'Azur|FR|43.3|5.44
Brookline|MA|US|42.33|-71.12
Novi|MI|US|42.48|-83.48
Jaguariuna|Sao Paulo|BR|-22.71|-46.99
Pestlorinc|Budapest|HU|47.43|19.22
Littlehampton|England|GB|50.81|-0.54
Er Roseires|Blue Nile|SD|11.87|34.39
Tokoname|Aichi|JP|34.88|136.85
Arsen'yev|Primorye|RU|44.16|133.27
Shwegu|Kachin State|MM|24.23|96.79
Viseu|Para|BR|-1.2|-46.14
Hanyu|Saitama|JP|36.17|139.53
Salehieh|Tehran|IR|35.51|51.19
Des Plaines|IL|US|42.03|-87.88
Beliatta|Southern Province|LK|6.05|80.73
Kampong Dungun|Perak|MY|3.22|101.32
Hameln|Lower Saxony|DE|52.1|9.36
Carrara|Tuscany|IT|44.08|10.1
Taifu|Sichuan|CN|28.98|105.64
Los Patios|Norte de Santander Department|CO|7.84|-72.5
Mnihla|Ariana Governorate|TN|36.85|10.11
Carson City|NV|US|39.16|-119.77
Padangpanjang|West Sumatra|ID|-0.46|100.41
Orland Park|IL|US|41.63|-87.85
San Pedro Ayampuc|Guatemala|GT|14.78|-90.45
Oume|Goh-Djiboua|CI|6.38|-5.42
Mpondwe|Western Region|UG|0.04|29.72
Nuzvid|Andhra Pradesh|IN|16.79|80.85
Frutal|Minas Gerais|BR|-20.02|-48.94
Nga Nam|Can Tho City|VN|9.57|105.6
Bartlett|TN|US|35.2|-89.87
Glogovac|Pristina|XK|42.63|20.89
Beitbridge|Matabeleland South Province|ZW|-22.22|30
Guerara|Ghardaia|DZ|32.79|4.5
Toki|Gifu|JP|35.35|137.18
Woodland|CA|US|38.68|-121.77
Lonavla|Maharashtra|IN|18.75|73.41
Loum|Littoral|CM|4.72|9.74
Shiqiaozi|Shandong|CN|36.16|119.26
Una|Gujarat|IN|20.82|71.04
Jidong|Heilongjiang|CN|45.26|131.12
Sao Gabriel|Rio Grande do Sul|BR|-30.34|-54.32
Lehi|UT|US|40.39|-111.85
Ouled Djellal|Ouled Djellal|DZ|34.43|5.06
Fenyi|Jiangxi|CN|27.81|114.67
Raciborz|Silesia|PL|50.09|18.22
White Plains|NY|US|41.03|-73.76
Uzlovaya|Tula Oblast|RU|53.98|38.16
Vasastaden|Stockholm|SE|59.35|18.03
Paombong|Central Luzon|PH|14.83|120.79
Weleri|Central Java|ID|-6.97|110.07
Chonglong|Sichuan|CN|29.78|104.85
Sayama|Osaka|JP|34.52|135.56
Xinglongshan|Jilin|CN|43.96|125.47
Choshi|Chiba|JP|35.73|140.83
San Pedro de Jujuy|Jujuy|AR|-24.23|-64.87
Al Hamul|Kafr el-Sheikh|EG|31.31|31.15
Fort Beaufort|Eastern Cape|ZA|-32.77|26.63
Benevento|Campania|IT|41.13|14.78
Arcadia|CA|US|34.14|-118.04
Reston|VA|US|38.97|-77.34
Friedrichshafen|Baden-Wurttemberg|DE|47.66|9.48
Batatais|Sao Paulo|BR|-20.89|-47.59
Finote Selam|Amhara|ET|10.7|37.27
Barkam|Sichuan|CN|31.9|102.22
Sakurai|Nara|JP|34.5|135.85
Chaiyaphum|Chaiyaphum|TH|15.81|102.03
Tongchuan|Sichuan|CN|31.09|105.09
Shibuzi|Shandong|CN|36.12|119.1
Uttaradit|Uttaradit|TH|17.63|100.09
Lixian|Gansu|CN|34.19|105.17
Murakami|Niigata|JP|38.23|139.48
Larbaa|Blida|DZ|36.56|3.15
Hongqiao|Hunan|CN|26.77|112.11
Serres|Central Macedonia|GR|41.08|23.55
Antsalova|Melaky|MG|-18.67|44.62
Trencin|Trencin Region|SK|48.89|18.04
Zizkov|Prague|CZ|50.08|14.45
Changbai|Jilin|CN|41.42|128.2
Zhutuo|Chongqing|CN|29.02|105.85
Korce|Korce County|AL|40.62|20.78
San Andres|San Andres y Providencia|CO|12.58|-81.7
Patzun|Chimaltenango|GT|14.68|-91.01
Bedzin|Silesia|PL|50.33|19.13
Sillod|Maharashtra|IN|20.3|75.65
Kirklareli|Kirklareli|TR|41.74|27.23
Colon|Entre Rios|AR|-32.22|-58.14
Ocala|FL|US|29.19|-82.14
Kisela Voda|Grad Skopje|MK|41.95|21.5
Niksic|Opstina Niksic|ME|42.77|18.94
Dingtao|Shandong|CN|35.07|115.57
Clay|NY|US|43.19|-76.17
Myaungmya|Ayeyarwady|MM|16.6|94.92
Omoa|Cortes Department|HN|15.78|-88.04
Dongxi|Chongqing|CN|28.76|106.66
Los Dos Caminos|Miranda|VE|10.49|-66.83
Monte Alegre|Para|BR|-2|-54.08
Arzew|Oran|DZ|35.85|-0.32
Central City|AZ|US|33.44|-112.06
Petauke|Eastern Province|ZM|-14.24|31.32
Kanbe|Yangon|MM|16.71|96
Ar Rumaythiyah|Hawalli|KW|29.31|48.07
Taby|Stockholm|SE|59.44|18.07
South Vineland|NJ|US|39.45|-75.03
Lorient|Brittany|FR|47.75|-3.37
Sanford|FL|US|28.8|-81.27
Juye|Shandong|CN|35.39|116.07
Ekangala|Gauteng|ZA|-25.67|28.73
Nahariyya|Northern District|IL|33.01|35.1
Dapaong|Savanes|TG|10.86|0.21
Felgueiras|Porto|PT|41.37|-8.19
Serian|Sarawak|MY|1.17|110.57
Streatham|England|GB|51.43|-0.13
Goeppingen|Baden-Wurttemberg|DE|48.7|9.65
Zgierz|Lodz Voivodeship|PL|51.86|19.41
Caucasia|Antioquia|CO|7.99|-75.19
Bowie|MD|US|38.94|-76.73
Simpang Empat|Perak|MY|4.95|100.63
Port Coquitlam|British Columbia|CA|49.27|-122.77
Invercargill|Southland|NZ|-46.4|168.35
Volzhsk|Mariy-El Republic|RU|55.87|48.36
Kokomo|IN|US|40.49|-86.13
Chornomors'k|Odesa|UA|46.3|30.66
Sarcelles|Ile-de-France|FR|49|2.38
Jatiwangi|West Java|ID|-6.73|108.26
Acambaro|Guanajuato|MX|20.03|-100.72
Vigevano|Lombardy|IT|45.31|8.85
Kawthoung|Tanintharyi Region|MM|9.98|98.55
Pessac|New Aquitaine|FR|44.81|-0.63
Imaricho-ko|Saga|JP|33.27|129.88
Magsaysay|Davao Region|PH|6.77|125.18
Santa Rosa de Cabal|Risaralda Department|CO|4.87|-75.62
Sira|Karnataka|IN|13.74|76.9
Baekrajan|Central Java|ID|-6.77|110.85
Wayne|NJ|US|40.93|-74.28
Uniao da Vitoria|Parana|BR|-26.23|-51.09
Kraaifontein|Western Cape|ZA|-33.85|18.72
Hardenberg|Overijssel|NL|52.58|6.62
Ivry-sur-Seine|Ile-de-France|FR|48.82|2.38
Kokubu-matsuki|Kagoshima|JP|31.73|130.77
San Francisco El Alto|Totonicapan|GT|14.94|-91.44
Chikhli|Maharashtra|IN|20.35|76.26
Veles|Veles|MK|41.72|21.77
Al Wasitah|Faiyum|EG|29.34|31.21
Tabaco|Bicol Region|PH|13.36|123.73
Jing'an|Jiangsu|CN|34.5|116.92
Belen|Loreto|PE|-3.76|-73.25
Pianura|Campania|IT|40.86|14.17
Kogalym|Khanty-Mansia|RU|62.27|74.48
Jhargram|West Bengal|IN|22.45|86.99
Evreux|Normandy|FR|49.02|1.15
Bootle|England|GB|53.47|-3.02
Santee|CA|US|32.84|-116.97
Emin|Xinjiang|CN|46.53|83.63
Ponte Nova|Minas Gerais|BR|-20.42|-42.91
Orito|Putumayo Department|CO|0.67|-76.87
Longtan|Chongqing|CN|28.76|108.96
Shenliu|Hunan|CN|29.41|112.16
Lop Buri|Lopburi|TH|14.8|100.65
Ksar|Nouakchott West|MR|18.1|-15.96
Goerlitz|Saxony|DE|51.16|14.99
Dublin|CA|US|37.7|-121.94
St. Albert|Alberta|CA|53.63|-113.64
Hagere Maryam|Oromiya|ET|5.63|38.24
Stolberg|North Rhine-Westphalia|DE|50.77|6.23
la Nova Esquerra de l'Eixample|Catalonia|ES|41.38|2.15
Ash Shamiyah|Al-Qadisiyah|IQ|31.96|44.6
Avila|Castille and Leon|ES|40.66|-4.7
Moreno|Pernambuco|BR|-8.12|-35.09
Maocun|Jiangsu|CN|34.38|117.25
Mongagua|Sao Paulo|BR|-24.09|-46.62
Harsin|Kermanshah Province|IR|34.27|47.59
Santa Luzia|Maranhao|BR|-3.96|-45.66
Sundsvall|Vaesternorrland|SE|62.39|17.31
Bebington|England|GB|53.35|-3.02
El Hatillo|Miranda|VE|10.42|-66.83
Legnano|Lombardy|IT|45.6|8.92
Taquara|Rio Grande do Sul|BR|-29.65|-50.78
Venissieux|Auvergne-Rhone-Alpes|FR|45.7|4.89
Kagaznagar|Telangana|IN|19.33|79.47
Cergy|Ile-de-France|FR|49.04|2.08
Albu Kamal|Deir ez-Zor|SY|34.45|40.92
Trang Bom|Dong Nai|VN|10.95|107.01
Ban Pong|Ratchaburi|TH|13.82|99.88
Krymsk|Krasnodar Krai|RU|44.93|37.99
Huangpi|Hubei|CN|30.88|114.38
Shanhecun|Heilongjiang|CN|45.71|128.58
Hernals|Vienna|AT|48.23|16.31
Biala Podlaska|Lublin|PL|52.03|23.12
Bhatapara|Chhattisgarh|IN|21.73|81.95
Yantongshan|Jilin|CN|43.29|126.01
Kasibugga|Andhra Pradesh|IN|18.76|84.42
Vynohradar|Kyiv City|UA|50.51|30.42
Guarabira|Paraiba|BR|-6.85|-35.49
Cupang|National Capital Region|PH|14.43|121.04
Hasanpur|Uttar Pradesh|IN|28.72|78.28
Clichy|Ile-de-France|FR|48.9|2.31
Na Di|Prachin Buri|TH|14.12|101.78
Guiren|Jiangsu|CN|33.67|118.19
Chongwe|Lusaka Province|ZM|-15.33|28.68
Maulavi Bazar|Sylhet Division|BD|24.49|91.77
Palm Harbor|FL|US|28.08|-82.76
Kan'onjicho|Kagawa|JP|34.13|133.65
Santo Tomas|Calabarzon|PH|14.11|121.14
Linares|Andalusia|ES|38.1|-3.64
Lohardaga|Jharkhand|IN|23.43|84.68
Kentau|Turkistan|KZ|43.52|68.5
Manicore|Amazonas|BR|-5.81|-61.3
Marinilla|Antioquia|CO|6.17|-75.34
Medford|MA|US|42.42|-71.11
Kidderminster|England|GB|52.39|-2.25
Myaydo|Magway|MM|19.37|95.22
Cheremkhovo|Irkutsk Oblast|RU|53.15|103.08
Morley|England|GB|53.74|-1.6
Taquaritinga|Sao Paulo|BR|-21.41|-48.5
Jahangirabad|Uttar Pradesh|IN|28.41|78.11
Sherkot|Uttar Pradesh|IN|29.33|78.57
Siu Lek Yuen|Sha Tin|HK|22.38|114.21
Katras|Jharkhand|IN|23.8|86.3
El Menia|El Menia|DZ|30.58|2.88
Minbu|Magway|MM|20.18|94.88
Zhongxing|Jiangsu|CN|33.7|118.68
Halabja|Halabja|IQ|35.18|45.99
Talagante|Santiago Metropolitan|CL|-33.66|-70.93
Langxiang|Heilongjiang|CN|46.95|128.87
Kaffrine|Kaffrine|SN|14.11|-15.55
Catacaos|Piura|PE|-5.27|-80.68
Garoowe|Nugaal|SO|8.4|48.48
Kota Sambas|West Kalimantan|ID|1.36|109.3
Coruripe|Alagoas|BR|-10.13|-36.18
Macherla|Andhra Pradesh|IN|16.48|79.44
Naksalbari|West Bengal|IN|26.68|88.22
Sankarankovil|Tamil Nadu|IN|9.17|77.54
Mulbagal|Karnataka|IN|13.16|78.39
Paris 09 Opera|Ile-de-France|FR|48.87|2.34
Kolaboui|Boke Region|GN|10.8|-14.4
Midwest City|OK|US|35.45|-97.4
Icara|Santa Catarina|BR|-28.71|-49.3
Kandukur|Andhra Pradesh|IN|15.22|79.9
Center City|PA|US|39.95|-75.16
Nonoichi|Ishikawa|JP|36.53|136.62
Margate|FL|US|26.24|-80.21
Tiruvalla|Kerala|IN|9.38|76.57
Roshanpura|Delhi|IN|28.6|76.99
Villa Hayes|Presidente Hayes|PY|-25.09|-57.53
Thanbyuzayat|Mon|MM|15.97|97.73
Andradina|Sao Paulo|BR|-20.9|-51.38
Andradas|Minas Gerais|BR|-22.07|-46.57
Bergama|Izmir Province|TR|39.12|27.18
Ponnuru|Andhra Pradesh|IN|16.07|80.55
Vargem Grande|Maranhao|BR|-3.54|-43.92
Boufarik|Blida|DZ|36.57|2.91
Chitral|Khyber Pakhtunkhwa|PK|35.85|71.79
South Whittier|CA|US|33.95|-118.04
Bageqi|Xinjiang|CN|37.14|79.84
Saint-Andre|Reunion|RE|-20.96|55.65
Kollegal|Karnataka|IN|12.15|77.11
Tinley Park|IL|US|41.57|-87.78
Hamada|Shimane|JP|34.88|132.08
Mukandpur|Delhi|IN|28.74|77.18
Bando|Ibaraki|JP|36.07|139.87
Anamur|Mersin|TR|36.08|32.84
Suiling|Heilongjiang|CN|47.23|127.11
Pflugerville|TX|US|30.44|-97.62
Mafraq|Mafraq|JO|32.34|36.21
Wenxing|Hunan|CN|28.68|112.88
Unjha|Gujarat|IN|23.8|72.39
Frankfurt (Oder)|Brandenburg|DE|52.35|14.55
Fiche|Oromiya|ET|9.8|38.73
Zhigulevsk|Samara Oblast|RU|53.4|49.51
Alenquer|Para|BR|-1.94|-54.74
Yingli|Shandong|CN|37.06|118.81
Sakaidecho|Kagawa|JP|34.32|133.84
Cristo Rey|Nacional|DO|18.5|-69.93
Kamyaran|Kurdistan Province|IR|34.8|46.94
Chhibramau|Uttar Pradesh|IN|27.15|79.5
Borujen|Chaharmahal and Bakhtiari|IR|31.97|51.29
As Sawani|Al Jafarah|LY|32.72|13.07
Nurabad|Fars|IR|30.11|51.52
Tilhar|Uttar Pradesh|IN|27.96|79.74
Dehdasht|Kohgiluyeh and Boyer-Ahmad|IR|30.79|50.57
New Brunswick|NJ|US|40.49|-74.45
Annaka|Gunma|JP|36.33|138.9
Lunglei|Mizoram|IN|22.89|92.74
Jahangira|Khyber Pakhtunkhwa|PK|33.96|72.22
Grand Forks|ND|US|47.93|-97.03
Emmen|Drenthe|NL|52.78|6.91
Phra Phutthabat|Saraburi|TH|14.73|100.8
Colegiales|Buenos Aires F.D.|AR|-34.57|-58.45
Sokol'niki|Moscow|RU|55.8|37.67
Sokol|Moscow|RU|55.8|37.52
Reyhanli|Hatay|TR|36.27|36.57
Baishishan|Jilin|CN|43.58|127.57
Fountain Valley|CA|US|33.71|-117.95
Hoskote|Karnataka|IN|13.07|77.8
Hendala|Western Province|LK|6.99|79.88
Haripur|Khyber Pakhtunkhwa|PK|34|72.93
Minokamo|Gifu|JP|35.48|137.02
Roslavl'|Smolensk Oblast|RU|53.95|32.86
Stourbridge|England|GB|52.46|-2.14
Byasanagar|Odisha|IN|20.96|86.13
North Hills|CA|US|34.24|-118.48
Tres Pontas|Minas Gerais|BR|-21.37|-45.51
Ninghai|Shandong|CN|37.38|121.61
Manfredonia|Apulia|IT|41.63|15.92
Veszprem|Veszprem|HU|47.09|17.91
Anlong Veaeng|Otar Meanchey|KH|14.23|104.08
Neu-Hohenschoenhausen|State of Berlin|DE|52.57|13.51
Bayt Lahya|Gaza Strip|PS|31.55|34.5
Foligno|Umbria|IT|42.95|12.7
Zhuzhai|Jiangsu|CN|34.76|116.81
Purbalingga|Central Java|ID|-7.39|109.36
Xam Nua|Houaphan|LA|20.42|104.05
Diamond Bar|CA|US|34.03|-117.81
Kitgum|Northern Region|UG|3.28|32.89
Baden-Baden|Baden-Wurttemberg|DE|48.76|8.24
Bada Barabil|Odisha|IN|22.11|85.39
Hattingen|North Rhine-Westphalia|DE|51.4|7.19
Samalkot|Andhra Pradesh|IN|17.06|82.18
Caacupe|Cordillera Department|PY|-25.39|-57.14
Muko|Kyoto|JP|34.97|135.7
Karimganj|Assam|IN|24.87|92.36
La Dolorita|Miranda|VE|10.49|-66.79
Livingston|Scotland|GB|55.9|-3.52
Umm Ruwaba|North Kordofan|SD|12.91|31.22
Ushuaia|Tierra del Fuego|AR|-54.81|-68.32
Nogata|Fukuoka|JP|33.74|130.72
Bobbili|Andhra Pradesh|IN|18.57|83.36
Barri de Sant Andreu|Catalonia|ES|41.44|2.19
Jinji|Guangxi|CN|23.23|110.83
Fana|Koulikoro|ML|12.78|-6.96
Marseille 11|Provence-Alpes-Cote d'Azur|FR|43.29|5.44
Taunton|MA|US|41.9|-71.09
Fussa|Tokyo|JP|35.74|139.32
Ambalangoda|Southern Province|LK|6.24|80.05
Batac City|Ilocos|PH|18.06|120.56
Oak Lawn|IL|US|41.71|-87.76
Union|NJ|US|40.7|-74.26
Ankeny|IA|US|41.73|-93.61
Battir|West Bank|PS|31.7|35.12
Malard|Tehran|IR|35.67|50.98
Weining|Guizhou|CN|26.85|104.23
Mettur|Tamil Nadu|IN|11.79|77.8
Chicopee|MA|US|42.15|-72.61
Sattenapalle|Andhra Pradesh|IN|16.39|80.15
San Vicent del Raspeig|Valencia|ES|38.4|-0.53
Castlereagh|Northern Ireland|GB|54.57|-5.88
Kettering|England|GB|52.4|-0.73
Morondava|Menabe|MG|-20.29|44.32
Paudalho|Pernambuco|BR|-7.9|-35.18
Qingfu|Sichuan|CN|28.44|104.52
Jamrud|Khyber Pakhtunkhwa|PK|34|71.38
Pirapora|Minas Gerais|BR|-17.34|-44.94
Daokou|Henan|CN|35.57|114.52
Okcheon|North Chungcheong|KR|36.3|127.57
Tirurangadi|Kerala|IN|11.04|75.92
Yashan|Guangxi|CN|22.2|109.94
Woluwe-Saint-Lambert|Brussels Capital|BE|50.84|4.43
Lingayen|Ilocos|PH|16.02|120.23
Masinloc|Central Luzon|PH|15.54|119.95
Borovichi|Novgorod Oblast|RU|58.39|33.92
Hilden|North Rhine-Westphalia|DE|51.17|6.93
Wellingborough|England|GB|52.3|-0.69
Mafra|Santa Catarina|BR|-26.11|-49.81
Tennala|Kerala|IN|10.99|75.94
Budapest XII. keruelet|Budapest|HU|47.49|19.01
Aylmer|Quebec|CA|45.4|-75.81
Chakradharpur|Jharkhand|IN|22.68|85.63
Obera|Misiones|AR|-27.49|-55.12
Irving Park|IL|US|41.95|-87.74
Doertyol|Hatay|TR|36.84|36.23
Limoeiro|Pernambuco|BR|-7.87|-35.45
Urena|Tachira|VE|7.92|-72.44
Capitao Poco|Para|BR|-1.75|-47.06
Porto Ferreira|Sao Paulo|BR|-21.85|-47.48
Acu|Rio Grande do Norte|BR|-5.58|-36.91
Sendhwa|Madhya Pradesh|IN|21.69|75.1
Nantai|Liaoning|CN|40.92|122.8
Sao Francisco|Minas Gerais|BR|-15.95|-44.86
Palmares|Pernambuco|BR|-8.68|-35.59
Sukuta|Western|GM|13.41|-16.71
Balai Pungut|Riau|ID|1.06|101.29
Talegaon Dabhade|Maharashtra|IN|18.74|73.68
Potenza|Basilicate|IT|40.64|15.81
Changleng|Jiangxi|CN|28.7|115.82
Chernaya Rechka|Leningradskaya Oblast'|RU|59.99|30.3
Saint-Michel|Quebec|CA|45.57|-73.62
Hiriyur|Karnataka|IN|13.94|76.62
Rolim de Moura|Rondonia|BR|-11.8|-61.8
Chino|Nagano|JP|35.99|138.15
Mocoa|Putumayo Department|CO|1.15|-76.65
Boudouaou|Boumerdes|DZ|36.73|3.41
Registro|Sao Paulo|BR|-24.49|-47.84
Mizuho|Gifu|JP|35.39|136.67
Winterhude|Hamburg|DE|53.59|10.01
Anjangaon|Maharashtra|IN|21.17|77.31
Mon Repos|San Fernando|TT|10.28|-61.45
Tarneit|Victoria|AU|-37.84|144.66
Cangucu|Rio Grande do Sul|BR|-31.39|-52.68
Hutang|Jiangsu|CN|31.53|119.49
Pul-e Khumri|Baghlan|AF|35.94|68.72
Berwyn|IL|US|41.85|-87.79
Sanchuan|Yunnan|CN|26.75|100.66
Charkhi Dadri|Haryana|IN|28.59|76.27
Chau Phong|An Giang|VN|10.72|105.13
Caleta Olivia|Santa Cruz|AR|-46.45|-67.52
Ujhani|Uttar Pradesh|IN|28|79.01
Manhattan|KS|US|39.18|-96.57
Honiara|Honiara|SB|-9.43|159.95
Fier|Fier County|AL|40.73|19.56
Trairi|Ceara|BR|-3.28|-39.27
Sitou|Shandong|CN|36.31|118.41
Kaedi|Gorgol|MR|16.15|-13.51
Bankra|West Bengal|IN|22.6|88.28
Mendaha|Jambi|ID|-1.02|103.59
Forest|Brussels Capital|BE|50.82|4.33
Dabhoi|Gujarat|IN|22.18|73.43
Kut-e 'Abdollah|Khuzestan|IR|31.24|48.66
Zibihu|Yunnan|CN|26.11|99.95
Mutsu|Aomori|JP|41.29|141.22
Teghra|Bihar|IN|25.49|85.94
Baidi|Chongqing|CN|31.06|109.59
Sleman|Yogyakarta|ID|-7.72|110.36
Gaogou|Jiangsu|CN|34.02|119.19
Espinal|Tolima Department|CO|4.15|-74.88
Huauchinango|Puebla|MX|20.17|-98.05
Vranje|Central Serbia|RS|42.55|21.9
Kirishi|Leningradskaya Oblast'|RU|59.47|32.04
Goelcuek|Kocaeli|TR|40.72|29.82
Khartsyzk|Donetsk|UA|48.04|38.14
Linghai|Liaoning|CN|41.17|121.37
Turbaco|Bolivar|CO|10.33|-75.41
Dongola|Northern State|SD|19.18|30.48
Paita|Piura|PE|-5.09|-81.11
Kendale Lakes|FL|US|25.71|-80.41
Smyrna|GA|US|33.88|-84.51
Dearborn Heights|MI|US|42.34|-83.27
Humaita|Amazonas|BR|-7.52|-63.03
Longshi|Chongqing|CN|30.21|106.46
Hermanus|Western Cape|ZA|-34.42|19.23
Moncalieri|Piedmont|IT|45|7.68
Rhodes|South Aegean|GR|36.44|28.22
Obra|Uttar Pradesh|IN|24.42|82.99
Umm el Fahm|Haifa|IL|32.52|35.15
Kobo|Amhara|ET|10.03|39.85
Xuzhuang|Jiangsu|CN|34.3|117.46
Sankt Augustin|North Rhine-Westphalia|DE|50.78|7.2
Duong Noi|Hanoi|VN|20.98|105.75
Ayapel|Cordoba|CO|8.31|-75.14
Tiruvallur|Tamil Nadu|IN|13.14|79.91
Mandapeta|Andhra Pradesh|IN|16.86|81.93
Kutu|Mai-Ndombe|CD|-2.72|18.15
Tirur|Kerala|IN|10.91|75.92
Porterville|CA|US|36.07|-119.02
Kimilili|Bungoma County|KE|0.79|34.72
Piscataway|NJ|US|40.5|-74.4
Kandi|Alibori|BJ|11.13|2.94
Pandak|Yogyakarta|ID|-7.91|110.29
Ropar|Punjab|IN|30.97|76.53
Gongyi|Henan|CN|34.76|113.01
Al Badari|Asyut|EG|26.99|31.42
Hendersonville|TN|US|36.3|-86.62
Roeselare|Flanders|BE|50.95|3.12
Melo|Cerro Largo|UY|-32.37|-54.16
Papatoetoe|Auckland|NZ|-36.97|174.84
Eisen|Gyeongsangbuk-do|KR|35.97|128.93
Dangila|Amhara|ET|11.27|36.83
Bonga|South West Ethiopia Peoples' Region|ET|7.29|36.24
Kapenguria|West Pokot County|KE|1.24|35.11
Ezhva|Komi|RU|61.81|50.73
Namakkal|Tamil Nadu|IN|11.22|78.17
Toumodi|Lacs District|CI|6.56|-5.02
Cuneo|Piedmont|IT|44.39|7.55
Qinnan|Jiangsu|CN|33.25|119.91
Barabai|South Kalimantan|ID|-2.58|115.38
Arcot|Tamil Nadu|IN|12.91|79.32
Liski|Voronezh Oblast|RU|50.98|39.5
Gelan|Chongqing|CN|30.04|107.12
Morningside Heights|NY|US|40.81|-73.96
Zvyahel|Zhytomyr Oblast|UA|50.59|27.61
San Francisco|Heredia Province|CR|9.99|-84.13
Laharpur|Uttar Pradesh|IN|27.71|80.9
Impasugong|Northern Mindanao|PH|8.31|125
Tran Van Thoi|Ca Mau|VN|9.08|104.98
Kudamatsu|Yamaguchi|JP|34.01|131.87
Kuala Selangor|Selangor|MY|3.35|101.25
Vryburg|North West|ZA|-26.96|24.73
Bolvadin|Afyonkarahisar Province|TR|38.71|31.05
Dalianwan|Liaoning|CN|39.03|121.69
Changling|Jilin|CN|44.27|123.98
Chumphon|Chumphon|TH|10.5|99.18
Mozambique|Nampula|MZ|-15.03|40.73
Tirhanimine|Tanger-Tetouan-Al Hoceima|MA|35.24|-3.95
Viramgam|Gujarat|IN|23.13|72.05
Hoang Liet|Hanoi|VN|20.96|105.84
Zarrin Shahr|Isfahan|IR|32.39|51.38
San Rafael|Zulia|VE|10.96|-71.73
Rocky Mount|NC|US|35.94|-77.79
Belem|Sao Paulo|BR|-23.54|-46.59
Corvallis|OR|US|44.56|-123.26
Eschweiler|North Rhine-Westphalia|DE|50.82|6.27
Berrouaghia|Medea|DZ|36.14|2.91
Tsevie|Maritime|TG|6.43|1.21
Elk|Warmia-Masuria|PL|53.83|22.36
San Antonio|Central Department|PY|-25.42|-57.55
Ain Touta|Batna|DZ|35.38|5.9
Olympia|WA|US|47.04|-122.9
Valdosta|GA|US|30.83|-83.28
Asadabad|Hamadan Province|IR|34.78|48.12
Islampur|West Bengal|IN|26.27|88.19
Navirai|Mato Grosso do Sul|BR|-23.07|-54.19
Bonan|Yunnan|CN|25.46|99.53
Zile|Tokat Province|TR|40.3|35.89
Serowe|Central|BW|-22.39|26.71
Dibaya-Lubwe|Kwilu|CD|-4.16|19.86
Karad|Maharashtra|IN|17.29|74.18
Hanford|CA|US|36.33|-119.65
Kampung Bukit Baharu|Melaka|MY|2.22|102.29
Kawm Hamadah|Beheira|EG|30.76|30.7
Lubao|Central Luzon|PH|14.94|120.6
Shibirghan|Jowzjan|AF|36.67|65.75
Hashtgerd|Alborz Province|IR|35.96|50.68
'Ardamata|Western Darfur|SD|13.48|22.49
My Drarga|Souss-Massa|MA|30.38|-9.47
Zhuyi|Chongqing|CN|31.03|109.39
Yanam|Andhra Pradesh|IN|16.73|82.21
Klaeng|Rayong|TH|12.78|101.65
Dakhla|Souss-Massa|MA|30.41|-9.55
Swietochlowice|Silesia|PL|50.3|18.92
Rumonge|Rumonge|BI|-3.97|29.44
Abu Road|Rajasthan|IN|24.48|72.78
Yongqing|Gansu|CN|34.75|106.13
Castle Rock|CO|US|39.37|-104.86
Linqiong|Sichuan|CN|30.42|103.46
Snizhne|Donetsk|UA|48.02|38.76
Greenwood|IN|US|39.61|-86.11
Takizawa|Iwate|JP|39.8|141.13
Brazlandia|Federal District|BR|-15.68|-48.2
At Tall|Rif-dimashq|SY|33.61|36.31
Amuntai|South Kalimantan|ID|-2.42|115.25
Ha Giang|Tuyen Quang|VN|22.82|104.98
Nuevo Casas Grandes|Chihuahua|MX|30.42|-107.91
Chicago Lawn|IL|US|41.78|-87.7
Eminoenue|Istanbul|TR|41.02|28.97
Hempstead|NY|US|40.71|-73.62
Buthidaung Town|Rakhine|MM|20.88|92.53
Wellington|Western Cape|ZA|-33.64|19.01
Piedade|Sao Paulo|BR|-23.71|-47.43
Raxaul|Bihar|IN|26.98|84.85
Moonniyur|Kerala|IN|11.06|75.9
Novato|CA|US|38.11|-122.57
Kettering|OH|US|39.69|-84.17
Bellevue|NE|US|41.14|-95.89
Tlokweng|South-East|BW|-24.67|25.97
Barwani|Madhya Pradesh|IN|22.03|74.9
Qishan|Anhui|CN|29.84|117.72
Vyaz'ma|Smolensk Oblast|RU|55.21|34.3
Buriticupu|Maranhao|BR|-4.32|-46.45
Barrow in Furness|England|GB|54.11|-3.23
Videira|Santa Catarina|BR|-27.01|-51.15
Besuki|East Java|ID|-7.73|113.7
Ribnita|Transnistria|MD|47.77|29.01
Aurora|Ontario|CA|44|-79.47
Lanshan|Jiangsu|CN|33.94|117.72
Mangina|North Kivu|CD|0.6|29.31
Shoreline|WA|US|47.76|-122.34
Decatur|AL|US|34.61|-86.98
Luau|Moxico|AO|-10.71|22.22
Oued Rhiou|Relizane|DZ|35.96|0.92
Friedrichsfelde|State of Berlin|DE|52.51|13.51
Anjiang|Hunan|CN|27.32|110.1
San Fernando|San Fernando|TT|10.28|-61.47
Xinqing|Heilongjiang|CN|48.29|129.52
Gapyeong|Gyeonggi-do|KR|37.83|127.51
Ksar Hellal|Monastir Governorate|TN|35.65|10.89
Paramount|CA|US|33.89|-118.16
Beledweyne|Hiiraan|SO|4.74|45.2
Placetas|Villa Clara Province|CU|22.31|-79.65
Saint-Quentin|Hauts-de-France|FR|49.85|3.29
Mpulungu|Northern Province|ZM|-8.76|31.11
Tonsberg|Vestfold|NO|59.27|10.41
Bisceglie|Apulia|IT|41.24|16.5
Jaguare|Sao Paulo|BR|-23.54|-46.75
Kottayam|Kerala|IN|9.59|76.52
Pruszkow|Mazovia|PL|52.17|20.81
Bozueyuek|Bilecik|TR|39.91|30.04
Tiruttangal|Tamil Nadu|IN|9.48|77.83
Minamiuonuma|Niigata|JP|37.08|138.87
Bossangoa|Ouham|CF|6.49|17.46
Artur Nogueira|Sao Paulo|BR|-22.57|-47.17
Taliwang|West Nusa Tenggara|ID|-8.74|116.85
Port Arthur|TX|US|29.89|-93.94
Petlad|Gujarat|IN|22.48|72.8
Dorbod|Heilongjiang|CN|46.86|124.44
Sesvete|Zagreb|HR|45.83|16.12
Yutan|Hunan|CN|28.26|112.56
Abington|PA|US|40.12|-75.12
Anderson|IN|US|40.11|-85.68
Wedi|Central Java|ID|-7.74|110.58
Jalaun|Uttar Pradesh|IN|26.15|79.34
Ahu|Jiangsu|CN|34.38|118.6
Patzcuaro|Michoacan|MX|19.51|-101.61
Torrelavega|Cantabria|ES|43.35|-4.05
Hidaka|Saitama|JP|35.92|139.36
Satte|Saitama|JP|36.07|139.73
Djemmal|Monastir Governorate|TN|35.62|10.76
Periya Semur|Tamil Nadu|IN|11.36|77.69
Ahlen|North Rhine-Westphalia|DE|51.76|7.89
Tamiami|FL|US|25.76|-80.4
Ain Defla|Ain Defla|DZ|36.26|1.97
Kas|Southern Darfur|SD|12.51|24.29
Paris 05 Pantheon|Ile-de-France|FR|48.84|2.35
Nazarovo|Krasnoyarsk Krai|RU|56.01|90.42
Hulu Langat|Selangor|MY|3.11|101.81
Rubizhne|Luhansk|UA|49.01|38.38
Villa Bruzual|Portuguesa|VE|9.33|-69.12
Ramganj|Chittagong|BD|23.1|90.85
Madhupur|Jharkhand|IN|24.27|86.64
Dhuri|Punjab|IN|30.37|75.87
Pazardzhik|Pazardzhik|BG|42.2|24.33
Klimovsk|Moscow Oblast|RU|55.36|37.53
South Croydon|England|GB|51.36|-0.09
Towson|MD|US|39.4|-76.6
Naic|Calabarzon|PH|14.32|120.77
Challakere|Karnataka|IN|14.32|76.65
Bayan|Heilongjiang|CN|46.08|127.39
Etawa|Madhya Pradesh|IN|24.18|78.2
Zouerat|Tiris Zemmour|MR|22.74|-12.47
North Chicopee|MA|US|42.18|-72.6
Shijonawate|Osaka|JP|34.73|135.68
Elda|Valencia|ES|38.48|-0.79
Drean|El Tarf|DZ|36.68|7.75
Licha|Shandong|CN|36.06|119.78
Pingjin|Chongqing|CN|30.61|107.54
Chiplun|Maharashtra|IN|17.53|73.51
Uptown|IL|US|41.97|-87.65
Can Gio|Ho Chi Minh City (HCMC)|VN|10.41|106.95
Mandla|Madhya Pradesh|IN|22.6|80.37
Olimpia|Sao Paulo|BR|-20.74|-48.91
Abyek|Markazi|IR|36.07|50.55
Sao Jose do Rio Pardo|Sao Paulo|BR|-21.6|-46.89
Biel/Bienne|Bern|CH|47.14|7.25
Sarasota|FL|US|27.34|-82.53
Sabac|Central Serbia|RS|44.75|19.69
Narail|Khulna Division|BD|23.16|89.5
Kalasin|Kalasin|TH|16.43|103.51
Lesnoy|Sverdlovsk Oblast|RU|57.62|63.08
Canterbury|England|GB|51.28|1.08
Bhimunipatnam|Andhra Pradesh|IN|17.89|83.45
Rybatskoye|Leningradskaya Oblast'|RU|59.84|30.5
Eqbaliyeh|Qazvin Province|IR|36.23|49.92
Cepu|Central Java|ID|-7.15|111.59
Kaga-Bandoro|Nana-Grebizi|CF|6.99|19.19
Uritsk|St.-Petersburg|RU|59.84|30.18
Luang Prabang|Luang Prabang Province|LA|19.89|102.15
Sharifabad|Punjab|PK|33.43|73.36
Canoinhas|Santa Catarina|BR|-26.18|-50.39
Mawlai-Mawiong|Meghalaya|IN|25.62|91.88
Cuango-Luzamba|Luanda Norte|AO|-9.15|18.04
Caxito|Bengo|AO|-8.58|13.66
Shilin|Yunnan|CN|24.82|103.33
Jinotega|Jinotega Department|NI|13.09|-86
Zamoskvorech'ye|Moscow|RU|55.73|37.63
Pokrovskoye-Streshnevo|Moscow|RU|55.81|37.46
Berezovskiy|Kuzbass|RU|55.67|86.27
Waterloo|Western Area|SL|8.34|-13.07
Dunfermline|Scotland|GB|56.07|-3.46
Dompu|West Nusa Tenggara|ID|-8.54|118.46
Kavanur|Tamil Nadu|IN|13|80.08
Granja|Ceara|BR|-3.12|-40.83
Reghaia|Algiers|DZ|36.74|3.34
Liguo|Shandong|CN|34.55|117.33
Huangnihe|Jilin|CN|43.56|128.02
Viljoenskroon|Free State|ZA|-27.21|26.95
Tallang-dong|Jeju-do|KR|33.49|126.48
Saint-Jerome|Quebec|CA|45.78|-74
Cypress Hills|NY|US|40.68|-73.89
West Haven|CT|US|41.27|-72.95
Miyakojima|Okinawa|JP|24.79|125.31
Rosemead|CA|US|34.08|-118.07
Sabinas|Coahuila|MX|27.86|-101.12
Bad Salzuflen|North Rhine-Westphalia|DE|52.09|8.74
Cuenca|Castille-La Mancha|ES|40.07|-2.13
Derbendixan|Sulaymaniyah|IQ|35.11|45.69
Euskirchen|North Rhine-Westphalia|DE|50.66|6.79
Estancia|Western Visayas|PH|11.46|123.15
Opava|Moravian-Silesian Region|CZ|49.94|17.9
Yecheon|Gyeongsangbuk-do|KR|36.66|128.46
Edgewater|IL|US|41.98|-87.66
Pithapuram|Andhra Pradesh|IN|17.12|82.25
Al Khafji|Eastern Province|SA|28.44|48.49
Jackson|NJ|US|39.78|-74.86
Highland|CA|US|34.13|-117.21
Kandi|West Bengal|IN|23.96|88.04
San Jose de las Lajas|Mayabeque|CU|22.96|-82.15
Jonquiere|Quebec|CA|48.42|-71.25
Jelgava|Jelgava|LV|56.65|23.71
Mamoudzou|Mamoudzou|YT|-12.78|45.23
Meerbusch|North Rhine-Westphalia|DE|51.25|6.69
Sangaredi|Boke Region|GN|11.1|-13.77
Idappadi|Tamil Nadu|IN|11.59|77.84
Manzhouli|Inner Mongolia|CN|49.6|117.43
Caaguazu|Caaguazu Department|PY|-25.47|-56.02
Huguo|Sichuan|CN|28.59|105.37
Liuji|Jiangsu|CN|34.36|117.05
Asenovgrad|Plovdiv|BG|42.02|24.87
Sahibabad Daulotpur|Delhi|IN|28.75|77.11
Pozzo Strada|Piedmont|IT|45.07|7.63
Bandar Labuan|Sabah|MY|5.28|115.25
Mount Prospect|IL|US|42.07|-87.94
Punganuru|Andhra Pradesh|IN|13.37|78.57
Liangzhai|Jiangsu|CN|34.5|116.75
Wolfenbuettel|Lower Saxony|DE|52.16|10.54
Huyton|England|GB|53.41|-2.84
Bhamo|Kachin State|MM|24.25|97.23
Leytonstone|England|GB|51.57|0.01
Rio de Mouro|Lisbon|PT|38.77|-9.33
Huerth|North Rhine-Westphalia|DE|50.87|6.87
Luputa|Lomami|CD|-7.16|23.7
Jaguaquara|Bahia|BR|-13.53|-39.97
Barry|Wales|GB|51.4|-3.28
Odienne|Denguele District|CI|9.51|-7.56
San Josecito|Tachira|VE|7.66|-72.22
Boghni|Tizi Ouzou|DZ|36.54|3.95
Niort|New Aquitaine|FR|46.32|-0.46
Ghatal|West Bengal|IN|22.66|87.73
Burauen|Eastern Visayas|PH|10.98|124.89
Odivelas|Lisbon|PT|38.79|-9.18
Hamura|Tokyo|JP|35.76|139.32
Colton|CA|US|34.07|-117.31
San Marcos|San Salvador Department|SV|13.66|-89.18
Encanto|AZ|US|33.48|-112.08
Sibonga|Central Visayas|PH|10.02|123.62
Konan|Shiga|JP|35|136.1
Jafarabad|Delhi|IN|28.68|77.27
Wangji|Jiangsu|CN|33.98|117.75
Boa Viagem|Ceara|BR|-5.13|-39.73
Belfort|Bourgogne-Franche-Comte|FR|47.64|6.85
Giurgiu|Giurgiu County|RO|43.89|25.96
Sagar|Karnataka|IN|14.16|75.03
Sihor|Gujarat|IN|21.71|71.96
Huacho|Lima region|PE|-11.12|-77.61
Mundka|Delhi|IN|28.68|77.03
Al Mayadin|Deir ez-Zor|SY|35.02|40.45
Belorechensk|Krasnodar Krai|RU|44.77|39.87
El Banco|Magdalena Department|CO|9|-73.98
San Bernardino Tlaxcalancingo|Puebla|MX|19.03|-98.28
Himimachi|Toyama|JP|36.86|136.99
Dumyat al Jadidah|Damietta|EG|31.43|31.68
Bafang|West|CM|5.16|10.18
Chelghoum el Aid|Mila|DZ|36.16|6.17
Deglur|Maharashtra|IN|18.55|77.58
Acopiara|Ceara|BR|-6.1|-39.45
Meikle Earnock|Scotland|GB|55.75|-4.03
Hamilton|Scotland|GB|55.77|-4.03
Madhepura|Bihar|IN|25.92|86.79
Modica|Sicily|IT|36.86|14.76
Bandarban|Chittagong|BD|22.2|92.22
Nanzhou|Hunan|CN|29.36|112.41
Pocatello|ID|US|42.87|-112.45
Bradenton|FL|US|27.5|-82.57
Pasir Ris New Town||SG|1.37|103.95
Pirojpur|Barisal Division|BD|22.58|89.98
Swedru|Central|GH|5.54|-0.7
Bukit Tengah|Penang|MY|5.35|100.44
Baramati|Maharashtra|IN|18.15|74.58
Mahasamund|Chhattisgarh|IN|21.11|82.09
Margareten|Vienna|AT|48.19|16.35
Narva|Ida-Virumaa|EE|59.38|28.19
Rogers Park|IL|US|42.01|-87.67
Jinka|South Ethiopia Regional State|ET|5.65|36.65
Nelson|Nelson Region|NZ|-41.27|173.28
Ain El Aouda|Rabat-Sale-Kenitra|MA|33.8|-6.79
Xom Cai Nuoc|An Giang|VN|9.8|105.1
Weymouth|MA|US|42.22|-70.94
Sittingbourne|England|GB|51.34|0.73
Port Charlotte|FL|US|26.98|-82.09
Tharyarwady|Bago Region|MM|17.65|95.79
Yunjin|Sichuan|CN|29.08|105.64
Bom Despacho|Minas Gerais|BR|-19.74|-45.25
Normal|IL|US|40.51|-88.99
Ajaccio|Corsica|FR|41.92|8.74
Jagueey Grande|Matanzas Province|CU|22.53|-81.13
Javanrud|Kermanshah Province|IR|34.81|46.49
Eisenzicken|Burgenland|AT|47.28|16.26
Macclesfield|England|GB|53.26|-2.13
Az Za'ayin|Al Daayen|QA|25.58|51.48
Teramo|Abruzzo|IT|42.66|13.7
Bahla'|Ad Dakhiliyah|OM|22.98|57.3
Sidhi|Madhya Pradesh|IN|24.4|81.88
Luojing|Shanghai|CN|31.48|121.34
Zehlendorf|State of Berlin|DE|52.43|13.25
Krasnokamensk|Zabaykalskiy (Transbaikal) Kray|RU|50.09|118.03
Guapimirim|Rio de Janeiro|BR|-22.54|-42.98
Spring|TX|US|30.08|-95.42
Presidente Franco|Alto Parana Department|PY|-25.56|-54.61
Allapattah|FL|US|25.81|-80.22
Okaya|Nagano|JP|36.06|138.05
Durbanville|Western Cape|ZA|-33.83|18.65
Dullewala|Punjab|PK|31.83|71.44
Kerou|Atakora|BJ|10.83|2.1
Pir Jo Goth|Sindh|PK|27.59|68.62
Hietzing|Vienna|AT|48.19|16.3
Gravesend|England|GB|51.44|0.37
Zuerich (Kreis 11)|Zurich|CH|47.42|8.52
Pemangkat|West Kalimantan|ID|1.17|108.97
Richland|WA|US|46.29|-119.28
Eastleigh|England|GB|50.97|-1.35
Zinacantepec|Mexico|MX|19.28|-99.73
Euless|TX|US|32.84|-97.08
Sau Mau Ping|Kwun Tong District|HK|22.32|114.23
Dhanmondi|Dhaka Division|BD|23.74|90.39
Kupchino|St.-Petersburg|RU|59.86|30.39
Eldorado|Misiones|AR|-26.4|-54.62
Campo Belo|Minas Gerais|BR|-20.9|-45.28
Kasaragod|Kerala|IN|12.5|74.99
Garhchiroli|Maharashtra|IN|20.18|80.01
Blue Springs|MO|US|39.02|-94.28
Pakenham|Victoria|AU|-38.07|145.47
Cajica|Cundinamarca|CO|4.92|-74.03
Koumra|Mandoul|TD|8.92|17.55
East Pensacola Heights|FL|US|30.43|-87.18
Kalamata|Peloponnese|GR|37.04|22.11
As Sahil|Asyut|EG|27.06|31.34
Puttur|Andhra Pradesh|IN|13.44|79.55
Diffa|Diffa|NE|13.32|12.61
Jalor|Rajasthan|IN|25.35|72.62
Nirgua|Yaracuy|VE|10.15|-68.56
Samana|Punjab|IN|30.15|76.2
Bangassou|Mbomou|CF|4.74|22.82
Cerignola|Apulia|IT|41.27|15.9
Aranjuez|Madrid|ES|40.03|-3.6
Razampeta|Andhra Pradesh|IN|14.2|79.16
Wari|Maharashtra|IN|21.15|79.01
Chilanga Township|Lusaka Province|ZM|-15.57|28.27
Kwaggafontein|Mpumalanga|ZA|-25.33|28.94
Shella|Meghalaya|IN|25.18|91.64
Hacienda Heights|CA|US|33.99|-117.97
Fangcun|Jiangsu|CN|34.09|117.47
Palmaner|Andhra Pradesh|IN|13.2|78.75
Xihu|Taiwan|TW|23.96|120.48
Kavala|East Macedonia and Thrace|GR|40.94|24.41
Deolali|Maharashtra|IN|19.94|73.83
Lozova|Kharkiv|UA|48.89|36.31
Nuevitas|Camaguey|CU|21.54|-77.26
Suzaka|Nagano|JP|36.65|138.32
Vannes|Brittany|FR|47.66|-2.76
Kanakapura|Karnataka|IN|12.55|77.42
Schweinfurt|Bavaria|DE|50.05|10.22
Wokha|Nagaland|IN|26.1|94.26
Altuf'yevskiy|Moscow|RU|55.88|37.58
Ozone Park|NY|US|40.68|-73.84
Neustadt an der Weinstrasse|Rheinland-Pfalz|DE|49.35|8.14
Trani|Apulia|IT|41.28|16.41
Sartrouville|Ile-de-France|FR|48.95|2.19
Druzhkivka|Donetsk|UA|48.62|37.53
Umred|Maharashtra|IN|20.85|79.32
Sabbashahr|Tehran|IR|35.58|51.11
Yongjian|Yunnan|CN|25.43|100.21
Bandar-e Torkaman|Golestan|IR|36.9|54.07
Iwade|Wakayama|JP|34.25|135.32
Maisons-Alfort|Ile-de-France|FR|48.81|2.44
Kalna|West Bengal|IN|23.22|88.36
Ribeira do Pombal|Bahia|BR|-10.83|-38.54
Huesca|Aragon|ES|42.14|-0.41
Xiazhuang|Yunnan|CN|25.4|100.83
Beberibe|Ceara|BR|-4.18|-38.13
Barbosa|Antioquia|CO|6.44|-75.33
Timashyovsk|Krasnodar Krai|RU|45.62|38.95
Saint-Louis|Reunion|RE|-21.29|55.41
Lagoa da Prata|Minas Gerais|BR|-20.02|-45.54
Mingcun|Shandong|CN|36.75|119.64
Severomorsk|Murmansk|RU|69.07|33.41
Pandamaran|Selangor|MY|3.01|101.42
Phong Thanh|Ca Mau|VN|9.32|105.35
Barra|Bahia|BR|-11.09|-43.14
Chania|Crete|GR|35.51|24.03
Siena|Tuscany|IT|43.32|11.33
Mondlo|KwaZulu-Natal|ZA|-27.98|30.72
Domodedovo|Moscow Oblast|RU|55.44|37.75
Chenaran|Razavi Khorasan|IR|36.65|59.12
Briarwood|NY|US|40.71|-73.82
Eger|Heves County|HU|47.9|20.37
Pallichal|Kerala|IN|8.45|77.03
Jacona de Plancarte|Michoacan|MX|19.96|-102.31
Pishva|Tehran|IR|35.31|51.73
Tandoni|Tamil Nadu|IN|10.93|78.09
Parvatipuram|Andhra Pradesh|IN|18.78|83.43
Lingcheng|Jiangsu|CN|33.82|118.11
Cathedral City|CA|US|33.78|-116.47
Meaux|Ile-de-France|FR|48.96|2.88
Lakewood|NJ|US|40.1|-74.22
Kericho|Kericho County|KE|-0.37|35.28
Portici|Campania|IT|40.82|14.34
Vyshniy Volochek|Tver Oblast|RU|57.59|34.57
Kotharia|Gujarat|IN|22.23|70.82
Ottapalam|Kerala|IN|10.77|76.38
Al Ibrahimiyah|Sharqia|EG|30.72|31.56
Kurihama|Kanagawa|JP|35.23|139.7
Elyria|OH|US|41.37|-82.11
Mongo|Guera|TD|12.19|18.69
Pulheim|North Rhine-Westphalia|DE|51|6.81
Bim Son|Thanh Hoa Province|VN|20.08|105.86
Didwana|Rajasthan|IN|27.4|74.58
Jardines de la Silla|Nuevo Leon|MX|25.63|-100.19
Ostroleka|Mazovia|PL|53.09|21.58
Starachowice|Swietokrzyskie|PL|51.04|21.07
Markala|Segou|ML|13.68|-6.07
Pensacola|FL|US|30.42|-87.22
Wheaton|IL|US|41.87|-88.11
Kintampo|Bono East|GH|8.06|-1.73
Mercedes|Bicol Region|PH|14.11|123.01
Assi Bou Nif|Oran|DZ|35.69|-0.5
Commerce City|CO|US|39.81|-104.93
Santiago Teyahualco|Mexico|MX|19.66|-99.12
Begampur|Delhi|IN|28.73|77.07
Charikar|Parwan|AF|35.01|69.17
Arao|Kumamoto|JP|32.98|130.45
Jinding|Yunnan|CN|26.44|99.44
Blois|Centre-Val de Loire|FR|47.59|1.33
Smethwick|England|GB|52.49|-1.97
Al Maraghah|Sohag|EG|26.7|31.6
Safaga|Red Sea|EG|26.75|33.94
Hoboken|NJ|US|40.74|-74.03
Watsonville|CA|US|36.91|-121.76
Kongoussi|Centre-Nord|BF|13.33|-1.53
Gaddi Annaram|Telangana|IN|17.37|78.52
Coatepec|Veracruz|MX|19.45|-96.96
Dumraon|Bihar|IN|25.55|84.15
Miyoshi|Hiroshima|JP|34.8|132.85
Anapa|Krasnodar Krai|RU|44.89|37.32
El Kef|Kef Governorate|TN|36.17|8.7
Evora|Evora|PT|38.57|-7.9
Frydek-Mistek|Moravian-Silesian Region|CZ|49.68|18.35
San Bartolome de Tirajana|Canary Islands|ES|27.92|-15.57
Pamplona|Norte de Santander Department|CO|7.38|-72.65
Nerupperichchal|Tamil Nadu|IN|11.16|77.37
Ercolano|Campania|IT|40.81|14.35
Goshogawara|Aomori|JP|40.8|140.44
Nihommatsu|Fukushima|JP|37.58|140.43
Lake Havasu City|AZ|US|34.48|-114.32
Qingxichang|Chongqing|CN|28.4|108.9
Papantla de Olarte|Veracruz|MX|20.45|-97.32
Jaggaiahpet|Andhra Pradesh|IN|16.89|80.1
Hvidovre|Capital Region|DK|55.64|12.48
Jinhua|Yunnan|CN|26.54|99.92
Les Abymes|Guadeloupe|GP|16.27|-61.51
Buguruslan|Orenburg Oblast|RU|53.66|52.44
El Viejo|Chinandega Department|NI|12.66|-87.17
Inada|Ibaraki|JP|36.43|140.52
Marechal Candido Rondon|Parana|BR|-24.56|-54.06
Buique|Pernambuco|BR|-8.62|-37.16
Menemen|Izmir Province|TR|38.61|27.07
Woburn|Ontario|CA|43.77|-79.23
Extrema|Minas Gerais|BR|-22.85|-46.32
Braintree|England|GB|51.88|0.55
Ilo|Moquegua Department|PE|-17.63|-71.34
Buzhuang|Shandong|CN|36.91|119.56
Rampur Hat|West Bengal|IN|24.18|87.78
Brive-la-Gaillarde|New Aquitaine|FR|45.16|1.53
Chystyakove|Donetsk|UA|48.04|38.6
Klinteby Frihed|Zealand|DK|55.2|11.6
Avedore|Capital Region|DK|55.63|12.46
Khanapuram Haveli|Telangana|IN|17.26|80.17
Arles|Provence-Alpes-Cote d'Azur|FR|43.68|4.63
Goalpara|Assam|IN|26.18|90.63
Little Havana|FL|US|25.77|-80.23
Tuni|Andhra Pradesh|IN|17.36|82.55
Shiquan|Shaanxi|CN|33.04|108.24
Revere|MA|US|42.41|-71.01
Yangtun|Jiangsu|CN|34.88|116.88
Weymouth|England|GB|50.61|-2.46
Porto Feliz|Sao Paulo|BR|-23.21|-47.52
Chortoq|Namangan|UZ|41.07|71.82
Suphan Buri|Suphan Buri|TH|14.47|100.12
Beauvais|Hauts-de-France|FR|49.43|2.08
Laxmangarh|Rajasthan|IN|27.82|75.03
Rio Tercero|Cordoba|AR|-32.18|-64.11
Zhangfeng|Yunnan|CN|24.19|97.8
Sotsmisto|Donetsk|UA|48.74|37.59
Shahpur|Karnataka|IN|16.7|76.84
West New York|NJ|US|40.79|-74.01
Itabirito|Minas Gerais|BR|-20.25|-43.8
Itupiranga|Para|BR|-5.13|-49.33
Los Polvorines|Buenos Aires|AR|-34.5|-58.71
Voi|Taita Taveta|KE|-3.4|38.56
Bhongir|Telangana|IN|17.52|78.89
Chaozhou|Taiwan|TW|22.55|120.54
Tokamachi|Niigata|JP|37.13|138.77
Kelenfoeld|Budapest|HU|47.47|19.03
Puttur|Karnataka|IN|12.76|75.2
Chaeryong-up|South Hwanghae|KP|38.4|125.62
Yucaipa|CA|US|34.03|-117.04
Ullagaram|Tamil Nadu|IN|12.98|80.2
Porto Nacional|Tocantins|BR|-10.71|-48.42
Chateauroux|Centre-Val de Loire|FR|46.81|1.69
Sao Tome|Sao Tome Island|ST|0.34|6.73
Sri Dungargarh|Rajasthan|IN|28.1|74.01
Katerini|Central Macedonia|GR|40.27|22.51
Ayodhya|Uttar Pradesh|IN|26.8|82.2
Natitingou|Atakora|BJ|10.3|1.38
Montesilvano|Abruzzo|IT|42.51|14.15
Sampang|East Java|ID|-7.19|113.24
Mubarakpur|Uttar Pradesh|IN|26.09|83.29
Pathum Wan|Bangkok|TH|13.74|100.52
Consolacao|Sao Paulo|BR|-23.55|-46.66
Oami|Chiba|JP|35.52|140.32
Yousuo|Yunnan|CN|26.03|100.07
Amalapuram|Andhra Pradesh|IN|16.58|82.01
Gilroy|CA|US|37.01|-121.57
Tome|Biobio|CL|-36.62|-72.96
Hell-Ville|Diana|MG|-13.4|48.27
Arsikere|Karnataka|IN|13.31|76.26
Fryazevo|Moscow Oblast|RU|55.73|38.46
Vallecas|Madrid|ES|40.38|-3.62
Phaltan|Maharashtra|IN|17.99|74.43
Kabale|Western Region|UG|-1.25|29.99
Zhaozhuang|Jiangsu|CN|34.74|116.46
Poinciana|FL|US|28.14|-81.46
Ashta|Madhya Pradesh|IN|23.02|76.72
Sandila|Uttar Pradesh|IN|27.07|80.51
Tingo Maria|Huanuco Department|PE|-9.3|-76
Santa Isabel|Sao Paulo|BR|-23.32|-46.22
Silivri|Istanbul|TR|41.07|28.25
Cholet|Pays de la Loire|FR|47.06|-0.88
Novena||SG|1.32|103.84
Zawiercie|Silesia|PL|50.49|19.42
Ar Rastan|Homs|SY|34.93|36.73
Sinan|Jeollanam-do|KR|34.83|126.11
Bagheria|Sicily|IT|38.08|13.51
Vikarabad|Telangana|IN|17.34|77.9
Naka|Ibaraki|JP|36.05|140.17
Gummersbach|North Rhine-Westphalia|DE|51.03|7.56
Cava De Tirreni|Campania|IT|40.7|14.71
Baruipur|West Bengal|IN|22.37|88.43
Rioverde|San Luis Potosi|MX|21.93|-99.99
Tanjungagung|South Sumatra|ID|-3.94|103.8
Wat Tha Phra|Bangkok|TH|13.73|100.48
Oosterhout|North Brabant|NL|51.65|4.86
Gulariya|Lumbini Province|NP|28.21|81.35
Banes|Holguin Province|CU|20.96|-75.72
Miryang|Gyeongsangnam-do|KR|35.49|128.75
Frejus|Provence-Alpes-Cote d'Azur|FR|43.43|6.74
Zaragoza|Central Luzon|PH|15.45|120.8
Butterworth|Eastern Cape|ZA|-32.33|28.15
University of Texas|TX|US|30.29|-97.74
Al Sajaah|Sharjah|AE|25.32|55.63
Lahbab|Dubai|AE|25.04|55.59
'Izbat 'Ali as Sayyid|Beheira|EG|31.16|30.15
Nayf|Dubai|AE|25.27|55.3
Thai Binh|Hung Yen Province|VN|20.45|106.34
Itapage|Ceara|BR|-3.69|-39.59
Wilhelmsburg|Hamburg|DE|53.49|10.01
Hatogaya-honcho|Saitama|JP|35.83|139.74
Ciudad de Huajuapan de Leon|Oaxaca|MX|17.81|-97.78
Medias|Sibiu County|RO|46.17|24.35
Khanzhonkivskyi|Donetsk|UA|48.1|38.04
Ben Jerrar|Souss-Massa|MA|30.26|-9.5
Bartolome Maso|Granma Province|CU|20.17|-76.94
Bitlis|Bitlis|TR|38.4|42.11
Kingsport|TN|US|36.55|-82.56
Swakopmund|Erongo Region|NA|-22.68|14.53
Svyatoshyn|Kyiv City|UA|50.46|30.35
Choudwar|Odisha|IN|20.54|85.92
Tangzhang|Jiangsu|CN|34.15|117.25
Levittown|PA|US|40.16|-74.83
Alexandroupoli|East Macedonia and Thrace|GR|40.85|25.88
Aversa|Campania|IT|40.97|14.21
Shahabad|Karnataka|IN|17.13|76.94
Waiblingen|Baden-Wurttemberg|DE|48.83|9.32
Nueva Guinea|South Caribbean Coast|NI|11.69|-84.46
Palm Beach Gardens|FL|US|26.82|-80.14
Pantin|Ile-de-France|FR|48.89|2.41
Velletri|Lazio|IT|41.69|12.78
Tha Maka|Kanchanaburi|TH|13.9|99.77
Sultanganj|Bihar|IN|25.24|86.74
Congonhas|Minas Gerais|BR|-20.51|-43.86
Enerhodar|Zaporizhzhia|UA|47.49|34.66
Patuto|Calabarzon|PH|14.12|120.97
Mandi Dabwali|Haryana|IN|29.97|74.7
Tan Uyen|Ho Chi Minh City (HCMC)|VN|11.08|106.79
Buseresere|Geita|TZ|-3.05|31.89
Lingwu|Ningxia|CN|38.1|106.34
Lyon 06|Auvergne-Rhone-Alpes|FR|45.77|4.85
Taoyuan|Jiangsu|CN|33.85|117.77
'Ali Abad-e Katul|Golestan|IR|36.91|54.87
Imara Daima Estate|Nairobi County|KE|-1.32|36.88
Verviers|Wallonia|BE|50.59|5.86
Bordj el Bahri|Algiers|DZ|36.79|3.25
San Jose del Guaviare|Guaviare Department|CO|2.57|-72.64
Delmiro Gouveia|Alagoas|BR|-9.39|-38
Rondon do Para|Para|BR|-4.78|-48.07
Nordhorn|Lower Saxony|DE|52.43|7.07
Cocorote|Yaracuy|VE|10.32|-68.78
Agaro|Oromiya|ET|7.85|36.65
Port Shepstone|KwaZulu-Natal|ZA|-30.74|30.45
Adilcevaz|Bitlis|TR|38.8|42.73
Trichardt|Mpumalanga|ZA|-26.49|29.23
Saint-Brieuc|Brittany|FR|48.52|-2.77
Konch|Uttar Pradesh|IN|25.99|79.15
Yokkaichi|Oita|JP|33.54|131.33
Milford|CT|US|41.22|-73.06
Beisu|Hebei|CN|38.15|114.81
Bandar-e Genaveh|Bushehr|IR|29.58|50.52
Cua Nam|Hanoi|VN|21.02|105.85
Baprola|Delhi|IN|28.64|77.01
Kota Tinggi|Johor|MY|1.74|103.9
Muadamiyat al-Sham|Rif-dimashq|SY|33.46|36.2
Mariendorf|State of Berlin|DE|52.44|13.38
Delano|CA|US|35.77|-119.25
Colcapirhua|Cochabamba|BO|-17.39|-66.24
Universitats- und Hansestadt Greifswald|Mecklenburg-Vorpommern|DE|54.09|13.4
West Sacramento|CA|US|38.58|-121.53
Wulingyuan|Hunan|CN|29.35|110.54
Malingshan|Jiangsu|CN|34.2|118.36
Yartsevo|Smolensk Oblast|RU|55.06|32.7
Huntersville|NC|US|35.41|-80.84
Pabbi|Khyber Pakhtunkhwa|PK|34.01|71.79
Krasnokamsk|Perm Krai|RU|58.08|55.76
Venkatagiri|Andhra Pradesh|IN|13.96|79.58
Ergani|Diyarbakir Province|TR|38.27|39.75
Perth Amboy|NJ|US|40.51|-74.27
Rio Grande|Tierra del Fuego|AR|-53.79|-67.71
Cuxhaven|Lower Saxony|DE|53.87|8.7
Sherman Oaks|CA|US|34.15|-118.45
Sao Francisco do Sul|Santa Catarina|BR|-26.24|-48.64
Ridder|East Kazakhstan|KZ|50.35|83.52
Shiogama|Miyagi|JP|38.32|141.03
Hualong|Shandong|CN|36.95|118.59
Wetzlar|Hesse|DE|50.56|8.5
Bau|Sarawak|MY|1.42|110.15
Palapye|Central|BW|-22.55|27.13
Tramandai|Rio Grande do Sul|BR|-29.98|-50.13
Boadilla del Monte|Madrid|ES|40.41|-3.88
Alesund|More og Romsdal|NO|62.47|6.15
Kahnuj|Kerman|IR|27.94|57.7
Utrera|Andalusia|ES|37.19|-5.78
Dianbu|Shandong|CN|36.7|120.35
Tukh|Qalyubia|EG|30.35|31.2
Zabid|Al Hudaydah|YE|14.2|43.32
Southaven|MS|US|34.99|-90.01
Vila Guilherme|Sao Paulo|BR|-23.51|-46.61
Brentwood|England|GB|51.62|0.31
Niono|Segou|ML|14.25|-5.99
Imbituba|Santa Catarina|BR|-28.24|-48.67
Dabhel|Dadra and Nagar Haveli and Daman and Diu|IN|20.41|72.88
Amora|Setubal|PT|38.63|-9.12
Saint Peters|MO|US|38.8|-90.63
Daxing|Yunnan|CN|27.26|100.86
Terbanggi Besar|Lampung|ID|-4.88|105.22
Maiquetia|Vargas|VE|10.59|-66.96
Puji|Shandong|CN|36.13|119.72
Downtown DC|DC|US|38.89|-77.02
Caucagueito|Miranda|VE|10.49|-66.74
Pryluky|Chernihiv Oblast|UA|50.6|32.38
Lalian|Punjab|PK|31.82|72.8
Harrisonburg|VA|US|38.45|-78.87
Corroios|Setubal|PT|38.64|-9.15
Biswan|Uttar Pradesh|IN|27.5|81
Peabody|MA|US|42.53|-70.93
Lautoka|Western|FJ|-17.62|177.45
Thongwa|Yangon|MM|16.76|96.52
Qabula|Punjab|PK|30.18|73.07
Placentia|CA|US|33.87|-117.87
Jaen|Cajamarca Department|PE|-5.71|-78.81
Siruguppa|Karnataka|IN|15.63|76.89
Kosi|Uttar Pradesh|IN|27.79|77.44
Jette|Brussels Capital|BE|50.87|4.33
Lenexa|KS|US|38.95|-94.73
DeSoto|TX|US|32.59|-96.86
Mollet del Valles|Catalonia|ES|41.54|2.21
Pursat|Pursat|KH|12.54|103.92
Pir Mahal|Punjab|PK|30.77|72.43
Ciudad Bolivia|Barinas|VE|8.35|-70.57
Burlington|NC|US|36.1|-79.44
Sironj|Madhya Pradesh|IN|24.1|77.69
Nametil|Nampula|MZ|-15.72|39.34
Menden|North Rhine-Westphalia|DE|51.44|7.78
Montauban|Occitanie|FR|44.02|1.35
Tomiya|Miyagi|JP|38.39|140.89
South Hill|WA|US|47.14|-122.27
Kyaiklat|Ayeyarwady|MM|16.45|95.72
Tarhuna|Al Marqab|LY|32.44|13.63
Charleville-Mezieres|Grand Est|FR|49.77|4.72
Albi|Occitanie|FR|43.93|2.15
Campos do Jordao|Sao Paulo|BR|-22.74|-45.59
Al 'Aziziyah|Al Jafarah|LY|32.53|13.02
Xingqiao|Zhejiang|CN|30.4|120.25
Jangaon|Telangana|IN|17.73|79.15
Esher|England|GB|51.37|-0.37
Ivato|Analamanga|MG|-18.8|47.48
Mithi|Sindh|PK|24.74|69.8
Daudnagar|Bihar|IN|25.03|84.4
Paraiso do Tocantins|Tocantins|BR|-10.18|-48.87
Zalau|Salaj County|RO|47.2|23.05
Metrotown|British Columbia|CA|49.23|-123
Hannan|Osaka|JP|34.33|135.25
Elkhart|IN|US|41.68|-85.98
Bergkamen|North Rhine-Westphalia|DE|51.62|7.64
Kamifukuoka|Saitama|JP|35.87|139.51
Frechen|North Rhine-Westphalia|DE|50.91|6.81
Obidos|Para|BR|-1.92|-55.52
La Crosse|WI|US|43.8|-91.24
Chagni||ET|10.96|36.5
Eilat|Southern District|IL|29.56|34.95
Dandeli|Karnataka|IN|15.27|74.62
Ramapuram|Tamil Nadu|IN|13.03|80.18
Welland|Ontario|CA|42.98|-79.25
Plottier|Neuquen|AR|-38.97|-68.23
Oak Park|IL|US|41.89|-87.78
Mansoura|Tlemcen|DZ|34.86|-1.34
Ponticelli|Campania|IT|40.85|14.33
Noshiro|Akita|JP|40.21|140.03
Songlingcun|Hebei|CN|40.29|118.27
Santo Estevao|Bahia|BR|-12.43|-39.25
Tengrela|Savanes District|CI|10.48|-6.41
Florissant|MO|US|38.79|-90.32
Hruzkyi|Donetsk|UA|48.07|37.94
Kalamansig|Soccsksargen|PH|6.55|124.05
Fryazino|Moscow Oblast|RU|55.96|38.05
Sammamish|WA|US|47.64|-122.08
Yunshan|Shandong|CN|36.82|120.23
Malungun|Soccsksargen|PH|6.28|125.28
Kakata|Margibi County|LR|6.53|-10.35
Kobryn|Brest|BY|52.21|24.36
Matamoros|Coahuila|MX|25.53|-103.23
Hervey Bay|Queensland|AU|-25.29|152.77
Cangandala|Malanje|AO|-9.78|16.43
Pula|Istria|HR|44.87|13.85
Dapeng|Jiangsu|CN|34.28|117.08
Victoria|Mimaropa|PH|13.18|121.28
Sanzhuang|Shandong|CN|35.5|119.17
Shiraoka|Saitama|JP|36.02|139.66
Zarinsk|Altai Krai|RU|53.71|84.94
Inhumas|Goias|BR|-16.36|-49.5
Wakefield|NY|US|40.9|-73.85
Se||MO|22.19|113.55
Matilda Estate||SG|1.4|103.9
Tres Arroyos|Buenos Aires|AR|-38.38|-60.28
Mudhol|Karnataka|IN|16.33|75.28
Ban Talat Yai|Phuket|TH|7.88|98.4
Erbaa|Tokat Province|TR|40.67|36.57
Tavsanli|Kuetahya|TR|39.54|29.5
Arandas|Jalisco|MX|20.71|-102.35
Albany|OR|US|44.64|-123.11
Zhawa|Xinjiang|CN|37.21|79.63
Sandwip|Chittagong|BD|22.51|91.45
Antratsyt|Luhansk|UA|48.12|39.09
Jitai|Shandong|CN|36.76|118.74
Ban Lak Song|Bangkok|TH|13.69|100.4
Hoffman Estates|IL|US|42.04|-88.08
Nyagan|Khanty-Mansia|RU|62.14|65.39
Sar-e Pul|Sar-e Pol Province|AF|36.22|65.93
Lichtenrade|State of Berlin|DE|52.4|13.41
Ad Darwa|Casablanca-Settat|MA|33.37|-7.54
Tarbes|Occitanie|FR|43.23|0.07
Dobo|Maluku|ID|-5.76|134.23
Davtashen|Yerevan|AM|40.22|44.48
Albany Park|IL|US|41.97|-87.72
Guaxupe|Minas Gerais|BR|-21.31|-46.71
Fontenay-sous-Bois|Ile-de-France|FR|48.85|2.48
Kimry|Tver Oblast|RU|56.87|37.36
Mouscron|Wallonia|BE|50.74|3.21
Ar Riqqah|Al Ahmadi|KW|29.15|48.09
Ta Khmau|Kandal|KH|11.48|104.95
Zizhuang|Jiangsu|CN|34.36|117.49
Parobe|Rio Grande do Sul|BR|-29.63|-50.83
Liangji|Jiangsu|CN|33.96|117.97
Chake Chake|Pemba South|TZ|-5.25|39.77
Thodupuzha|Kerala|IN|9.89|76.72
Methuen|MA|US|42.73|-71.19
Kirumba|North Kivu|CD|-1.09|29.29
Pinar del Rey|Madrid|ES|40.47|-3.65
Thomazeau|Ouest|HT|18.65|-72.09
Kariya|Hyogo|JP|34.75|134.39
Caetite|Bahia|BR|-14.07|-42.48
Glendora|CA|US|34.14|-117.87
Lamia|Central Greece|GR|38.9|22.43
Satkania|Chittagong|BD|22.08|92.05
Jurmala|Jurmala|LV|56.97|23.77
Levoberezhnyy|Moscow|RU|55.86|37.47
Wilmington|CA|US|33.78|-118.26
Mokolo|Far North|CM|10.74|13.8
Huamantla|Tlaxcala|MX|19.31|-97.93
Anwen|Zhejiang|CN|29.06|120.44
Izumi|Kagoshima|JP|32.08|130.37
Lyon 09|Auvergne-Rhone-Alpes|FR|45.77|4.8
Al Aaroui|Oriental|MA|35.01|-3.01
Dunstable|England|GB|51.89|-0.52
Ciudad Piar|Bolivar|VE|7.45|-63.32
Port Macquarie|New South Wales|AU|-31.43|152.91
University Heights|Saskatchewan|CA|52.14|-106.58
Nioro|Kayes|ML|15.23|-9.59
Kepanjen|East Java|ID|-8.13|112.57
San Severo|Apulia|IT|41.69|15.38
Queens Village|NY|US|40.73|-73.74
Dashahe|Jiangsu|CN|34.54|116.62
Roskilde|Zealand|DK|55.64|12.08
Gjilan|Gjilan|XK|42.46|21.47
Usulutan|Usulutan|SV|13.34|-88.44
Brookhaven|GA|US|33.86|-84.34
Evry|Ile-de-France|FR|48.63|2.44
Thi Tran Phuoc Buu|Ho Chi Minh City (HCMC)|VN|10.53|107.4
Duzhou|Chongqing|CN|29.88|107.08
Corralillo|Villa Clara Province|CU|22.98|-80.59
Levittown|NY|US|40.73|-73.51
Meybod|Yazd Province|IR|32.25|54.02
Secondigliano|Campania|IT|40.9|14.27
Sa'dah|Sa'dah|YE|16.94|43.76
Palm Desert|CA|US|33.72|-116.38
Zhongxin|Yunnan|CN|26.62|101.27
Devakottai|Tamil Nadu|IN|9.95|78.82
Bad Homburg vor der Hoehe|Hesse|DE|50.23|8.62
Porvoo|Uusimaa|FI|60.39|25.67
Arwal|Bihar|IN|25.24|84.67
Louveira|Sao Paulo|BR|-23.09|-46.95
Willich|North Rhine-Westphalia|DE|51.26|6.55
Puertollano|Castille-La Mancha|ES|38.69|-4.11
Ostuncalco|Quetzaltenango|GT|14.87|-91.62
Weimiao|Jiangsu|CN|34.58|117.07
Joplin|MO|US|37.08|-94.51
Blora|Central Java|ID|-6.97|111.42
Boundiali|Savanes District|CI|9.52|-6.49
Mahdia|Mahdia Governorate|TN|35.5|11.06
Sao Gabriel da Cachoeira|Amazonas|BR|-0.12|-67.09
Orhangazi|Bursa Province|TR|40.49|29.31
Baljurashi|Al Bahah Region|SA|19.86|41.56
Enid|OK|US|36.4|-97.88
Calvia|Balearic Islands|ES|39.57|2.51
Palmas|Parana|BR|-26.48|-51.99
Tiu Keng Leng|Kwun Tong District|HK|22.3|114.25
Qishan|Jiangsu|CN|34.63|116.8
Lower Sackville|Nova Scotia|CA|44.78|-63.68
Kaliyaganj|West Bengal|IN|25.63|88.33
Nasirabad|Rajasthan|IN|26.3|74.73
Mampong|Ashanti|GH|7.06|-1.4
Leo|Centre-Ouest|BF|11.1|-2.11
Bulaq Abu al 'Ila|Cairo|EG|30.06|31.23
Saint John's|Saint John Parish|AG|17.12|-61.84
Ijebu-Jesa|Osun State|NG|7.68|4.82
Wanguru|Kirinyaga County|KE|-0.68|37.36
Vidnoye|Moscow Oblast|RU|55.55|37.71
Qoryooley|Lower Shabeelle|SO|1.79|44.53
Morumbi|Sao Paulo|BR|-23.6|-46.71
Bonita Springs|FL|US|26.34|-81.78
Sao Lourenco|Guangdong|CN|22.19|113.53
Kasba Tadla|Beni Mellal-Khenifra|MA|32.6|-6.27
Irondequoit|NY|US|43.21|-77.58
Zepu|Xinjiang|CN|38.19|77.27
Yeonggwang|Jeollanam-do|KR|35.28|126.51
Caldwell|ID|US|43.66|-116.69
Segovia|Castille and Leon|ES|40.95|-4.12
Minnetonka|MN|US|44.91|-93.5
En Nedjma|Oran|DZ|35.65|-0.57
Mikkeli|South Savo|FI|61.69|27.27
Bitonto|Apulia|IT|41.11|16.69
Liuquan|Jiangsu|CN|34.43|117.3
Futtsu|Chiba|JP|35.31|139.82
Morecambe|England|GB|54.07|-2.86
Pedregal|Panama|PA|9.07|-79.43
Sagrada Familia|Catalonia|ES|41.4|2.17
Shahr-e Babak|Kerman|IR|30.12|55.12
Pinellas Park|FL|US|27.84|-82.7
Tagawa|Fukuoka|JP|33.63|130.8
Xanxere|Santa Catarina|BR|-26.88|-52.4
Ibipora|Parana|BR|-23.27|-51.05
Tijucas|Santa Catarina|BR|-27.24|-48.63
Battle Creek|MI|US|42.32|-85.18
Maha Sarakham|Maha Sarakham|TH|16.18|103.3
Khagaul|Bihar|IN|25.58|85.05
Yeongam|Jeollanam-do|KR|34.8|126.7
Redhill|England|GB|51.24|-0.17
Barinitas|Barinas|VE|8.76|-70.41
Tachilek|Shan State|MM|20.45|99.88
Takab|West Azerbaijan|IR|36.4|47.11
Mazara del Vallo|Sicily|IT|37.66|12.59
Renfrew-Collingwood|British Columbia|CA|49.24|-123.04
Emden|Lower Saxony|DE|53.37|7.21
Welwyn Garden City|England|GB|51.8|-0.21
Ruropolis|Para|BR|-4.1|-54.91
Cardona|Calabarzon|PH|14.49|121.23
Sado|Niigata|JP|38.02|138.36
Arganda|Madrid|ES|40.3|-3.44
Miura|Kanagawa|JP|35.14|139.62
Agustin Codazzi|Cesar Department|CO|10.04|-73.24
Zhefang|Yunnan|CN|24.27|98.28
Horsham|England|GB|51.06|-0.33
Casa Grande|AZ|US|32.88|-111.76
Ksar Chellala|Tiaret|DZ|35.21|2.32
South Shore|IL|US|41.76|-87.58
Mott Haven|NY|US|40.81|-73.92
Viana|Maranhao|BR|-3.22|-45
The Villages|FL|US|28.93|-81.96
Grand Island|NE|US|40.93|-98.34
Susangerd|Khuzestan|IR|31.56|48.19
Changanacheri|Kerala|IN|9.44|76.54
Haabersti|Harjumaa|EE|59.42|24.65
Acre|Northern District|IL|32.93|35.08
GJo Son|Hai Phong|VN|20.71|106.79
Sanhui|Chongqing|CN|30.08|106.59
Jendouba|Jendouba Governorate|TN|36.5|8.78
Grapevine|TX|US|32.93|-97.08
Waehring|Vienna|AT|48.23|16.34
Clamart|Ile-de-France|FR|48.8|2.27
Tuytepa|Tashkent Region|UZ|41.03|69.36
Shorapur|Karnataka|IN|16.52|76.76
Neu-Ulm|Bavaria|DE|48.39|10.01
Bol|Lac|TD|13.47|14.71
Stratford|CT|US|41.18|-73.13
Uriangato|Guanajuato|MX|20.14|-101.18
Quibor|Lara|VE|9.93|-69.62
Mandvi|Gujarat|IN|22.83|69.35
El Nido|Mimaropa|PH|11.19|119.4
Rajgangpur|Odisha|IN|22.2|84.58
Patiya|Chittagong|BD|22.3|91.98
Kentwood|MI|US|42.87|-85.64
Kangavar|Kermanshah Province|IR|34.5|47.97
Morrinhos|Goias|BR|-17.73|-49.1
Tarma|Junin|PE|-11.42|-75.69
Nkowakowa|Limpopo|ZA|-23.89|30.29
Chautara|Bagmati Province|NP|27.78|85.71
Gopalganj|Dhaka Division|BD|23.22|90.06
Tulun|Irkutsk Oblast|RU|54.57|100.58
Lingen|Lower Saxony|DE|52.52|7.33
Samfya|Luapula Province|ZM|-11.36|29.56
Brejo da Madre de Deus|Pernambuco|BR|-8.15|-36.37
Sape|Paraiba|BR|-7.1|-35.23
Marseille 10|Provence-Alpes-Cote d'Azur|FR|43.28|5.42
Venice|Veneto|IT|45.44|12.33
Ozar|Maharashtra|IN|20.09|73.93
Coronel Oviedo|Caaguazu Department|PY|-25.45|-56.44
Baltim|Kafr el-Sheikh|EG|31.56|31.09
Barreiro|Setubal|PT|38.66|-9.07
Peranampattu|Tamil Nadu|IN|12.93|78.72
City of Milford (balance)|CT|US|41.22|-73.06
Las Aguilas|Madrid|ES|40.38|-3.77
Dianzi|Shandong|CN|36.9|119.87
Gumla|Jharkhand|IN|23.04|84.54
Chalons-en-Champagne|Grand Est|FR|48.95|4.37
Teoloyucan|Mexico|MX|19.74|-99.18
Tigard|OR|US|45.43|-122.77
East Hartford|CT|US|41.78|-72.61
Ramnagar|Uttarakhand|IN|29.39|79.13
Vazhakkala|Kerala|IN|10.01|76.33
Nichinan|Miyazaki|JP|31.6|131.37
Dartford|England|GB|51.45|0.21
Siocon|Zamboanga Peninsula|PH|7.71|122.14
Lakewood|Saskatchewan|CA|52.11|-106.59
Phra Nakhon|Bangkok|TH|13.77|100.5
Kabbasin|Aleppo|SY|36.43|37.57
Shujalpur|Madhya Pradesh|IN|23.41|76.71
Apple Valley|MN|US|44.73|-93.22
Plainfield|NJ|US|40.63|-74.41
Susono|Shizuoka|JP|35.17|138.91
Qulsary|Atyrau Oblisi|KZ|46.95|54.02
Leesburg|VA|US|39.12|-77.56
Erftstadt|North Rhine-Westphalia|DE|50.81|6.79
Ain Oulmene|Setif|DZ|35.92|5.3
Bejaad|Beni Mellal-Khenifra|MA|32.77|-6.39
Kapchorwa|Eastern Region|UG|1.4|34.45
Tirumangalam|Tamil Nadu|IN|9.82|77.98
Kruje|Durres County|AL|41.51|19.79
Bargny Guedj|Dakar|SN|14.69|-17.23
Bargny Ngoude|Dakar|SN|14.69|-17.24
Panlong|Chongqing|CN|29.5|105.37
Sidlaghatta|Karnataka|IN|13.39|77.86
Fuchu|Hiroshima|JP|34.39|132.51
El Bagre|Antioquia|CO|7.6|-74.81
Miyako|Iwate|JP|39.65|141.94
Leopoldina|Minas Gerais|BR|-21.53|-42.64
Parsippany|NJ|US|40.86|-74.43
Martin|Zilina Region|SK|49.07|18.92
Musina|Limpopo|ZA|-22.35|30.04
Coral Gables|FL|US|25.72|-80.27
Gangshang|Jiangsu|CN|34.52|118.12
Neubrueck|North Rhine-Westphalia|DE|51.13|6.64
Khurai|Madhya Pradesh|IN|24.04|78.33
Kayna|North Kivu|CD|-0.61|29.17
Reservoir|Victoria|AU|-37.72|145
Comal|Central Java|ID|-6.91|109.53
Seydisehir|Konya|TR|37.42|31.85
Guanshan|Jiangsu|CN|33.8|117.87
Ivanteyevka|Moscow Oblast|RU|55.97|37.92
Puerto Berrio|Antioquia|CO|6.49|-74.4
The Trails of Frisco|TX|US|33.16|-96.87
Hilsa|Bihar|IN|25.32|85.28
Sidi Taibi|Rabat-Sale-Kenitra|MA|34.19|-6.68
Staines|England|GB|51.43|-0.51
Hikari|Yamaguchi|JP|33.95|131.95
Datong|Chongqing|CN|28.6|106.67
Khalkhal|Ardabil Province|IR|37.62|48.53
Rampura Phul|Punjab|IN|30.28|75.24
Kot Mumin|Punjab|PK|32.19|73.03
Tadmur|Homs|SY|34.56|38.28
Pom Prap Sattru Phai|Bangkok|TH|13.76|100.51
The Hammocks|FL|US|25.67|-80.44
Jesus Menendez|Las Tunas Province|CU|21.16|-76.48
Tarif Kalba|Fujairah|AE|25.07|56.33
Bunawan|Caraga|PH|8.17|125.99
Ubauro|Sindh|PK|28.16|69.73
Gostivar|Gostivar|MK|41.8|20.91
Fatwa|Bihar|IN|25.51|85.31
Gombong|Central Java|ID|-7.61|109.51
Tundla|Uttar Pradesh|IN|27.21|78.24
Acayucan|Veracruz|MX|17.95|-94.91
Zoliborz|Mazovia|PL|52.27|20.99
Az Zulayl|Zarqa|JO|32.12|36.28
la Vila de Gracia|Catalonia|ES|41.4|2.16
Birkat as Sab'|Monufia|EG|30.63|31.08
Royal Leamington Spa|England|GB|52.29|-1.52
Mannarakkat|Kerala|IN|10.99|76.46
Shuijiang|Chongqing|CN|29.25|107.28
Tobias Barreto|Sergipe|BR|-11.18|-38
Metpalle|Telangana|IN|18.85|78.63
Whangarei|Northland|NZ|-35.73|174.32
Kosonsoy|Namangan|UZ|41.25|71.55
Gurlan|Xorazm Region|UZ|41.84|60.39
Cimitarra|Santander Department|CO|6.31|-73.95
Babila|Rif-dimashq|SY|33.47|36.33
Ha GJong|Hanoi|VN|20.97|105.78
Buckeye|AZ|US|33.37|-112.58
Naya Gaon|Punjab|IN|30.78|76.79
Repalle|Andhra Pradesh|IN|16.02|80.83
Hunsur|Karnataka|IN|12.3|76.29
Kyotango|Kyoto|JP|35.61|135.04
Teplice|Usti nad Labem Region|CZ|50.64|13.82
Vittoria|Sicily|IT|36.95|14.53
Donetsk|Rostov|RU|48.34|39.95
Tocumen|Panama|PA|9.09|-79.38
Flagami|FL|US|25.76|-80.32
Vigia|Para|BR|-0.86|-48.14
Phra Nakhon Si Ayutthaya|Phra Nakhon Si Ayutthaya|TH|14.35|100.58
Guanzhuang|Shandong|CN|36.26|119.19
Baijiantan|Xinjiang|CN|45.69|85.14
Barranqueras|Chaco|AR|-27.48|-58.94
Catalina Foothills|AZ|US|32.3|-110.92
Boende|Tshuapa|CD|-0.28|20.88
Salo|Southwest Finland|FI|60.38|23.13
Legionowo|Mazovia|PL|52.4|20.93
Yerba Buena|Tucuman|AR|-26.81|-65.3
Narbonne|Occitanie|FR|43.18|3
Lahr|Baden-Wurttemberg|DE|48.34|7.87
Monte Alto|Sao Paulo|BR|-21.26|-48.5
Padang Serai|Kedah|MY|5.51|100.55
Fuchucho|Hiroshima|JP|34.57|133.24
Chinu|Cordoba|CO|9.11|-75.4
Belleville|Ontario|CA|44.17|-77.38
Gelendzhik|Krasnodar Krai|RU|44.58|38.07
Hinckley|England|GB|52.54|-1.38
Yasu|Shiga|JP|35.1|136.02
Aspern|Vienna|AT|48.22|16.48
Rajanpur|Punjab|PK|29.1|70.33
Mao|Kanem|TD|14.12|15.31
Manaung|Rakhine|MM|18.85|93.73
Saint-Malo|Brittany|FR|48.65|-2.01
Estancia Velha|Rio Grande do Sul|BR|-29.65|-51.17
Sidikalang|North Sumatra|ID|2.75|98.31
Oshnaviyeh|West Azerbaijan|IR|37.04|45.1
Merzifon|Amasya|TR|40.87|35.46
Phetchabun|Phetchabun|TH|16.42|101.16
Lakewood|OH|US|41.48|-81.8
Adenta|Greater Accra|GH|5.71|-0.15
Al Husayniyah|Sharqia|EG|30.86|31.92
Yuki|Ibaraki|JP|36.3|139.88
Lytkarino|Moscow Oblast|RU|55.58|37.91
Shanji|Jiangsu|CN|34.2|117.6
Sangkapura|East Java|ID|-5.85|112.65
Suhum|Eastern|GH|6.04|-0.45
Saint Croix|Saint Croix Island|VI|17.73|-64.75
Nanjangud|Karnataka|IN|12.12|76.68
Lhuenzhub|Tibet|CN|29.89|91.26
Skien|Telemark|NO|59.21|9.61
Oi|Saitama|JP|35.85|139.52
Jaru|Rondonia|BR|-10.44|-62.47
Ibbenbueren|North Rhine-Westphalia|DE|52.28|7.71
Vila-real|Valencia|ES|39.94|-0.1
Tolga|Biskra|DZ|34.72|5.38
Kingisepp|Leningradskaya Oblast'|RU|59.38|28.61
Herning|Central Jutland|DK|56.14|8.98
Kizlyar|Dagestan|RU|43.85|46.71
Passau|Bavaria|DE|48.57|13.43
Abovyan|Kotayk|AM|40.27|44.63
Pelengana|Segou|ML|13.43|-6.22
El Negrito|Yoro Department|HN|15.32|-87.7
Clacton-on-Sea|England|GB|51.79|1.16
Gronau|North Rhine-Westphalia|DE|52.21|7.02
Kawalu|West Java|ID|-7.38|108.21
Zhob|Balochistan|PK|31.34|69.45
Cumbernauld|Scotland|GB|55.95|-3.99
Khorramdarreh|Zanjan|IR|36.21|49.2
Turbo|Antioquia|CO|8.09|-76.73
Kavakli|Istanbul|TR|41.09|28.33
Pivdenna Borshchahivka|Kyiv City|UA|50.41|30.4
Decan|Gjakova|XK|42.54|20.29
Budapest XXII. keruelet|Budapest|HU|47.43|19.04
Laval|Pays de la Loire|FR|48.07|-0.77
Hyeres|Provence-Alpes-Cote d'Azur|FR|43.12|6.13
Kyaukse|Mandalay Region|MM|21.61|96.14
Amahai|Maluku|ID|-3.34|128.92
Forbesganj|Bihar|IN|26.3|87.27
Can GJuoc|Tay Ninh|VN|10.51|106.6
North La Crosse|WI|US|43.85|-91.25
Burien|WA|US|47.47|-122.35
Nithari|Delhi|IN|28.7|77.05
Ambatondrazaka|Alaotra Mangoro|MG|-17.83|48.42
Tarnobrzeg|Subcarpathia|PL|50.57|21.68
Carsamba|Samsun|TR|41.2|36.72
Tafo|Ashanti|GH|6.73|-1.61
Tuyserkan|Hamadan Province|IR|34.55|48.44
Hanyuan|Shaanxi|CN|32.83|106.25
Langenhagen|Lower Saxony|DE|52.44|9.74
Gallarate|Lombardy|IT|45.66|8.79
Nova Venecia|Espirito Santo|BR|-18.71|-40.4
Willowdale East|Ontario|CA|43.77|-79.4
Havertown|PA|US|39.98|-75.31
Vargem Grande Paulista|Sao Paulo|BR|-23.6|-47.03
Arjona|Bolivar|CO|10.25|-75.34
San Mateo|Aragua|VE|10.21|-67.42
Bindura|Mashonaland Central|ZW|-17.3|31.33
Schwerte|North Rhine-Westphalia|DE|51.44|7.57
Taxco de Alarcon|Guerrero|MX|18.56|-99.61
Matli|Sindh|PK|25.04|68.66
North Bay|Ontario|CA|46.32|-79.47
Tubod|Northern Mindanao|PH|8.06|123.79
Sunabeda|Odisha|IN|18.73|82.83
Gajraula|Uttar Pradesh|IN|28.85|78.24
Yanghe|Shandong|CN|36.14|119.91
Logan|UT|US|41.74|-111.83
Kirkcaldy|Scotland|GB|56.12|-3.16
Khagrachhari|Chittagong|BD|23.11|91.97
Barriera di Milano|Piedmont|IT|45.09|7.69
Ness Ziona|Central District|IL|31.93|34.8
Ma'an|Ma'an|JO|30.2|35.73
Speyer|Rheinland-Pfalz|DE|49.32|8.43
Saint-Hyacinthe|Quebec|CA|45.63|-72.96
Mochudi|Kgatleng|BW|-24.42|26.15
Jahanian|Punjab|PK|30.04|71.82
Modimolle|Limpopo|ZA|-24.7|28.4
Torbali|Izmir Province|TR|38.18|27.34
Virapandi|Tamil Nadu|IN|11.06|77.35
Sek'ot'a|Amhara|ET|12.63|39.03
Nanao|Ishikawa|JP|37.05|136.97
Berwick|Victoria|AU|-38.03|145.35
South Peabody|MA|US|42.51|-70.95
Dahanu|Maharashtra|IN|19.97|72.71
Rovigo|Veneto|IT|45.07|11.79
Asakura|Fukuoka|JP|33.41|130.72
Midori|Gunma|JP|36.44|139.28
Rasipuram|Tamil Nadu|IN|11.46|78.19
Al Khaburah|Al Batinah North|OM|23.97|57.09
Saint-Gilles|Brussels Capital|BE|50.83|4.34
La Calera|Valparaiso|CL|-32.79|-71.2
Ventas|Madrid|ES|40.42|-3.65
Salur|Andhra Pradesh|IN|18.52|83.21
Chusovoy|Perm Krai|RU|58.29|57.81
Anju|South Pyongan|KP|39.62|125.66
Aliso Viejo|CA|US|33.57|-117.73
Bletchley|England|GB|51.99|-0.73
Villa Francisca|Nacional|DO|18.48|-69.89
Harrisburg|PA|US|40.27|-76.88
Galveston|TX|US|29.3|-94.8
Bhabhua|Bihar|IN|25.04|83.61
Yeovil|England|GB|50.94|-2.63
Keighley|England|GB|53.87|-1.91
Mui Ne|Lam Dong|VN|10.93|108.28
Mellit|Northern Darfur|SD|14.13|25.55
Macaubas|Bahia|BR|-13.02|-42.7
Kasaoka|Okayama|JP|34.51|133.5
Kotka|Kymenlaakso|FI|60.47|26.95
Poway|CA|US|32.96|-117.04
Hodal|Haryana|IN|27.89|77.37
Edina|MN|US|44.89|-93.35
Monapo|Nampula|MZ|-14.92|40.3
Otradnyy|Samara Oblast|RU|53.38|51.35
Minnetonka Mills|MN|US|44.94|-93.44
Balayan|Calabarzon|PH|13.94|120.73
Deressia|Tandjile|TD|9.76|16.27
Katanawa|Fukuoka|JP|33.52|130.42
Zacapu|Michoacan|MX|19.82|-101.79
Jihlava|Vysocina|CZ|49.4|15.59
Fungurume|Lualaba|CD|-10.62|26.32
Bhadrachalam|Telangana|IN|17.67|80.89
Snezhinsk|Chelyabinsk|RU|56.08|60.75
Dunaujvaros|Fejer|HU|46.96|18.94
Nanjian|Yunnan|CN|25.04|100.51
Uiju|P'yongan-bukto|KP|40.2|124.53
Sfantu Gheorghe|Covasna County|RO|45.87|25.78
Pijijiapan|Chiapas|MX|15.69|-93.21
Moyobamba|San Martin Department|PE|-6.03|-76.97
Alt-Hohenschoenhausen|State of Berlin|DE|52.55|13.5
Capivari|Sao Paulo|BR|-23|-47.51
Heidenheim an der Brenz|Baden-Wurttemberg|DE|48.68|10.15
Tateyama|Chiba|JP|34.98|139.87
Jatiroto|Central Java|ID|-7.88|111.12
Kibaigwa|Dodoma|TZ|-6.08|36.65
Chodov|Prague|CZ|50.04|14.5
Dogondoutchi|Dosso Region|NE|13.64|4.03
Werribee|Victoria|AU|-37.9|144.67
Naxi|Sichuan|CN|28.77|105.36
Zhenxi|Chongqing|CN|29.9|107.46
Bijar|Kurdistan Province|IR|35.87|47.61
Aonla|Uttar Pradesh|IN|28.27|79.17
Ali Sabih|Ali Sabieh|DJ|11.16|42.71
Tirupparangunram|Tamil Nadu|IN|9.88|78.07
Andulo|Bie|AO|-11.49|16.7
Treptow|State of Berlin|DE|52.49|13.44
Samara|Afar|ET|11.79|41.01
LOHAS Park|Sai Kung District|HK|22.29|114.27
Al-Hamdaniya|Nineveh|IQ|36.27|43.38
Sheladiz|Duhok|IQ|37.03|43.78
Barriera di Lanzo|Piedmont|IT|45.11|7.65
Arashiyama|Kyoto|JP|35.01|135.68
Aarsal|Baalbek-Hermel Governorate|LB|34.18|36.42
Ghazieh|South Governorate|LB|33.52|35.37
Hpa-An|Kayin State|MM|16.89|97.63
Polanco|Mexico City|MX|19.43|-99.2
Putrajaya|Putrajaya|MY|2.94|101.69
Sri Petaling|Kuala Lumpur|MY|3.07|101.69
Taman Melati|Kuala Lumpur|MY|3.22|101.72
Kuchai Lama|Kuala Lumpur|MY|3.08|101.69
Tipitapa|Managua Department|NI|12.2|-86.1
Juigalpa|Chontales Department|NI|12.11|-85.37
Ciudad Sandino|Managua Department|NI|12.16|-86.34
Rawalakot|Azad Kashmir|PK|33.86|73.76
Buni|Khyber Pakhtunkhwa|PK|36.27|72.26
Monsanto|Santarem|PT|39.46|-8.71
Novovladykino|Moscow|RU|55.85|37.58
Vatutino|Moscow|RU|55.88|37.69
Vagonoremont|Moscow|RU|55.9|37.55
Semenovskoye|Moscow Oblast|RU|55.68|37.55
Novokuz'minki|Moscow|RU|55.72|37.78
Novokhovrino|Moscow|RU|55.87|37.5
Nikol'skoye|Moscow|RU|55.68|37.48
Likhobory|Moscow|RU|55.85|37.57
Kozhukhovo|Moscow|RU|55.71|37.68
Kozeyevo|Moscow|RU|55.87|37.62
Akademgorodok|Novosibirsk Oblast|RU|54.85|83.11
Metrogorodok|Moscow|RU|55.81|37.79
Untolovo|Leningradskaya Oblast'|RU|60.01|30.21
'Ayn al 'Arab|Aleppo|SY|36.89|38.35
Ko Samui|Surat Thani|TH|9.54|99.94
Merter Keresteciler|Istanbul|TR|41.01|28.89
Guengoeren Merter|Istanbul|TR|41.01|28.89
Utengule|Mbeya|TZ|-8.9|33.33
Tukuyu|Mbeya|TZ|-9.25|33.65
Masumbwe|Geita|TZ|-3.63|32.18
Merelani|Arusha|TZ|-3.56|36.98
Bosse|Donetsk|UA|47.96|37.8
Stonecrest|GA|US|33.71|-84.13
Vinhomes Smart City|Hanoi|VN|21|105.74
Vinhomes Times City|Hanoi|VN|20.99|105.87
Cerritos|CA|US|33.86|-118.06
Redford|MI|US|42.38|-83.3
East Honolulu|HI|US|21.29|-157.72
Troy|NY|US|42.73|-73.69
Sunnyside|NY|US|40.74|-73.94
Lincoln|CA|US|38.89|-121.29
Wharton|PA|US|39.93|-75.16
Whitman|PA|US|39.92|-75.16
Downers Grove|IL|US|41.81|-88.01
Azusa|CA|US|34.13|-117.91
Wilson|NC|US|35.72|-77.92
Monroe|LA|US|32.51|-92.12
Parker|CO|US|39.52|-104.76
La Mirada|CA|US|33.92|-118.01
Minot|ND|US|48.23|-101.3
Aloha|OR|US|45.49|-122.87
Saginaw|MI|US|43.42|-83.95
Bedford|TX|US|32.84|-97.14
Rancho Santa Margarita|CA|US|33.64|-117.6
Cypress|CA|US|33.82|-118.04
Murray|UT|US|40.67|-111.89
Cuyahoga Falls|OH|US|41.13|-81.48
Coeur d'Alene|ID|US|47.68|-116.78
Bloomfield|NJ|US|40.81|-74.19
Port of Spain|Port of Spain|TT|10.67|-61.52
Rowland Heights|CA|US|33.98|-117.91
Covina|CA|US|34.09|-117.89
Stillwater|OK|US|36.12|-97.06
Niagara Falls|NY|US|43.09|-79.06
Collierville|TN|US|35.04|-89.66
Oxford Circle|PA|US|40.05|-75.07
Summerville|SC|US|33.02|-80.18
South Bel Air|MD|US|39.53|-76.34
Sheboygan|WI|US|43.75|-87.71
Middletown|OH|US|39.52|-84.4
Aspen Hill|MD|US|39.08|-77.07
Dunwoody|GA|US|33.95|-84.33
Huntington|WV|US|38.42|-82.45
Maricopa|AZ|US|33.06|-112.05
Roswell|NM|US|33.39|-104.52
Cedar Hill|TX|US|32.59|-96.96
East Brunswick|NJ|US|40.43|-74.42
East Lansing|MI|US|42.74|-84.48
Apopka|FL|US|28.68|-81.51
Maspeth|NY|US|40.72|-73.91
Wheaton|MD|US|39.04|-77.06
Mishawaka|IN|US|41.66|-86.16
Saipan|Saipan|MP|15.21|145.75
Portage|MI|US|42.2|-85.58
West Orange|NJ|US|40.8|-74.24
McLean|VA|US|38.93|-77.18
Newark|OH|US|40.06|-82.4
Ceres|CA|US|37.59|-120.96
Alexandria|LA|US|31.31|-92.45
Chesterfield|MO|US|38.66|-90.58
Barnstable|MA|US|41.7|-70.3
Salina|KS|US|38.84|-97.61
Lawrence|IN|US|39.84|-86.03
Bel Air South|MD|US|39.51|-76.32
Pearl City|HI|US|21.4|-157.98
Euclid|OH|US|41.59|-81.53
Roseville|MI|US|42.5|-82.94
Texas City|TX|US|29.38|-94.9
Wauwatosa|WI|US|43.05|-88.01
Waiau-Pacific Palisades|HI|US|21.4|-157.95
Vermont Square|CA|US|34|-118.3
Florin|CA|US|38.5|-121.41
Twin Falls|ID|US|42.56|-114.46
Glenview|IL|US|42.07|-87.79
East Providence|RI|US|41.81|-71.37
Palm Springs|CA|US|33.83|-116.55
San Luis Obispo|CA|US|35.28|-120.66
Mission District|CA|US|37.76|-122.42
Country Club|FL|US|25.95|-80.32
Gwynn Oak|MD|US|39.33|-76.69
Winnetka|CA|US|34.21|-118.57
Madison|AL|US|34.7|-86.75
Jeffersonville|IN|US|38.28|-85.74
San Jacinto|CA|US|33.78|-116.96
Mentor|OH|US|41.67|-81.34
Charleston|WV|US|38.35|-81.63
Mansfield|OH|US|40.76|-82.52
Hattiesburg|MS|US|31.33|-89.29
Draper|UT|US|40.52|-111.86
Middletown|CT|US|41.56|-72.65
Wylie|TX|US|33.02|-96.54
Columbus|IN|US|39.2|-85.92
Laguna|CA|US|38.42|-121.42
Smyrna|TN|US|35.98|-86.52
Charlottesville|VA|US|38.03|-78.48
Lacey|WA|US|47.03|-122.82
Makakilo / Kapolei / Honokai Hale|HI|US|21.34|-158.1
Littleton|CO|US|39.61|-105.02
Beavercreek|OH|US|39.71|-84.06
Kannapolis|NC|US|35.49|-80.62
Everett|MA|US|42.41|-71.05
Binghamton|NY|US|42.1|-75.92
Brighton|MA|US|42.35|-71.16
Elmhurst|IL|US|41.9|-87.94
Hell's Kitchen|NY|US|40.76|-73.99
Auburn Gresham|IL|US|41.74|-87.65
City of Sammamish|WA|US|47.6|-122.04
Antelope|CA|US|38.71|-121.33
Keller|TX|US|32.93|-97.25
Biloxi|MS|US|30.4|-88.89
Apex|NC|US|35.73|-78.85
West Lafayette|IN|US|40.43|-86.91
Cutler Bay|FL|US|25.58|-80.34
Titusville|FL|US|28.61|-80.81
Altoona|PA|US|40.52|-78.39
Newark|CA|US|37.53|-122.04
Oro Valley|AZ|US|32.39|-110.97
Saint Louis Park|MN|US|44.95|-93.35
Enfield|CT|US|41.98|-72.59
Dublin|OH|US|40.1|-83.11
Tuckahoe|VA|US|37.59|-77.56
Potomac|MD|US|39.02|-77.21
Cleveland Heights|OH|US|41.52|-81.56
Sayreville|NJ|US|40.46|-74.36
Hackensack|NJ|US|40.89|-74.04
Pine Bluff|AR|US|34.23|-92
West Seneca|NY|US|42.85|-78.8
Strongsville|OH|US|41.31|-81.84
Coachella|CA|US|33.68|-116.17
Penn Hills|PA|US|40.5|-79.84
Encino|CA|US|34.16|-118.5
Bentonville|AR|US|36.37|-94.21
Fort Pierce|FL|US|27.45|-80.33
Bridgewater|NJ|US|40.6|-74.65
Danville|CA|US|37.82|-122
Oakland Park|FL|US|26.17|-80.13
Attleboro|MA|US|41.94|-71.29
Severn|MD|US|39.14|-76.7
Blacksburg|VA|US|37.23|-80.41
Haltom City|TX|US|32.8|-97.27
Brighton Park|IL|US|41.82|-87.7
Lompoc|CA|US|34.64|-120.46
Wesley Chapel|FL|US|28.24|-82.33
Urbandale|IA|US|41.63|-93.71
York|PA|US|39.96|-76.73
Concord|NH|US|43.21|-71.54
North Miami Beach|FL|US|25.93|-80.16
El Centro|CA|US|32.79|-115.56
Rego Park|NY|US|40.73|-73.85
North Brunswick|NJ|US|40.45|-74.48
Cleveland|TN|US|35.16|-84.88
Echo Park|CA|US|34.08|-118.26
North Bethesda|MD|US|39.04|-77.12
Beaumont|CA|US|33.93|-116.98
Kalihi-Palama|HI|US|21.33|-157.88
Lombard|IL|US|41.88|-88.01
Bountiful|UT|US|40.89|-111.88
North Lauderdale|FL|US|26.22|-80.23
Burleson|TX|US|32.54|-97.32
Ocoee|FL|US|28.57|-81.54
Ashburn|VA|US|39.04|-77.49
Southington|CT|US|41.6|-72.88
Augusta|GA|US|33.47|-81.97
Bozeman|MT|US|45.68|-111.04
Sierra Vista|AZ|US|31.55|-110.3
Freeport|NY|US|40.66|-73.58
Pittsfield|MA|US|42.45|-73.25
Hilo|HI|US|19.73|-155.09
West Babylon|NY|US|40.72|-73.35
DeKalb|IL|US|41.93|-88.75
San Bruno|CA|US|37.63|-122.41
Altamonte Springs|FL|US|28.66|-81.37
Bell Gardens|CA|US|33.97|-118.15
Schertz|TX|US|29.55|-98.27
East Boston|MA|US|42.38|-71.04
Morgan Hill|CA|US|37.13|-121.65
Bothell|WA|US|47.76|-122.21
Fond du Lac|WI|US|43.77|-88.44
Sicklerville|NJ|US|39.72|-74.97
Sayreville Junction|NJ|US|40.47|-74.33
Farmington|NM|US|36.73|-108.22
Salem|MA|US|42.52|-70.9
Arlington|MA|US|42.42|-71.16
La Jolla|CA|US|32.85|-117.27
Altadena|CA|US|34.19|-118.13
Fairfield|OH|US|39.35|-84.56
Ashburn|IL|US|41.75|-87.71
Rancho Palos Verdes|CA|US|33.74|-118.39
North Highlands|CA|US|38.69|-121.37
Moline|IL|US|41.51|-90.52
East Concord|NH|US|43.24|-71.54
Jefferson City|MO|US|38.58|-92.17
Henrietta|NY|US|43.06|-77.61
Rockwall|TX|US|32.93|-96.46
Plainfield|IL|US|41.63|-88.2
Burlington|VT|US|44.48|-73.21
Rohnert Park|CA|US|38.34|-122.7
Urbana|IL|US|40.11|-88.21
Southglenn|CO|US|39.59|-104.95
Midland|MI|US|43.62|-84.25
Prescott Valley|AZ|US|34.61|-112.32
Joint Base Pearl Harbor Hickam|HI|US|21.35|-157.95
State College|PA|US|40.79|-77.86
Kearny|NJ|US|40.77|-74.15
El Dorado Hills|CA|US|38.69|-121.08
Danville|VA|US|36.59|-79.4
Belleville|IL|US|38.52|-89.98
Linden|NJ|US|40.62|-74.24
Moorhead|MN|US|46.87|-96.77
Woodside|NY|US|40.75|-73.91
Brea|CA|US|33.92|-117.9
Riverton|UT|US|40.52|-111.94
Prescott|AZ|US|34.54|-112.47
Mount Laurel|NJ|US|39.93|-74.89
The Colony|TX|US|33.09|-96.89
Manassas|VA|US|38.75|-77.48
Brentwood|TN|US|36.03|-86.78
Westfield|MA|US|42.13|-72.75
Hutchinson|KS|US|38.06|-97.93
Leominster|MA|US|42.53|-71.76
Catonsville|MD|US|39.27|-76.73
Hicksville|NY|US|40.77|-73.53
Bartlett|IL|US|42|-88.19
Buffalo Grove|IL|US|42.15|-87.96
Woonsocket|RI|US|42|-71.51
West Hills|CA|US|34.2|-118.64
Edmonds|WA|US|47.81|-122.38
Marana|AZ|US|32.44|-111.23
Shelton|CT|US|41.32|-73.09
Cedar Falls|IA|US|42.53|-92.45
Chatsworth|CA|US|34.26|-118.6
Gage Park|IL|US|41.8|-87.7
Beverly|MA|US|42.56|-70.88
University|FL|US|28.07|-82.44
Coppell|TX|US|32.95|-97.02
Findlay|OH|US|41.04|-83.65
Campbell|CA|US|37.29|-121.95
Lake Ridge|VA|US|38.69|-77.3
Burke|VA|US|38.79|-77.27
Mankato|MN|US|44.16|-94.01
Annandale|VA|US|38.83|-77.2
Covington|KY|US|39.08|-84.51
New City|IL|US|41.81|-87.66
Morris Heights|NY|US|40.85|-73.92
Peachtree Corners|GA|US|33.97|-84.22
South Valley|NM|US|35.01|-106.68
Ormond Beach|FL|US|29.29|-81.06
Carrollwood Village|FL|US|28.07|-82.52
Huntsville|TX|US|30.72|-95.55
Venice|CA|US|33.99|-118.46
Sumter|SC|US|33.92|-80.34
Annapolis|MD|US|38.98|-76.49
Quincy|IL|US|39.94|-91.41
Wilkes-Barre|PA|US|41.25|-75.88
Lincoln Square|IL|US|41.98|-87.69
La Puente|CA|US|34.02|-117.95
Holyoke|MA|US|42.2|-72.62
Sherman|TX|US|33.64|-96.61
Goose Creek|SC|US|32.98|-80.03
Maplewood|MN|US|44.95|-93
Streamwood|IL|US|42.03|-88.18
Fitchburg|MA|US|42.58|-71.8
Hilton Head Island|SC|US|32.19|-80.74
La Quinta|CA|US|33.66|-116.31
Crystal Lake|IL|US|42.24|-88.32
Hagerstown|MD|US|39.64|-77.72
San Gabriel|CA|US|34.1|-118.11
Apia|Tuamasaga|WS|-13.83|-171.77
Hickory|NC|US|35.73|-81.34
Beverly Cove|MA|US|42.55|-70.85
Winter Garden|FL|US|28.57|-81.59
Carol Stream|IL|US|41.91|-88.13
Tarawa|Gilbert Islands|KI|1.33|172.98
Warren|OH|US|41.24|-80.82
Marlboro|NJ|US|40.32|-74.25
Teaneck|NJ|US|40.9|-74.02
Calexico|CA|US|32.68|-115.5
Florence|AL|US|34.8|-87.68
St. Johns|FL|US|30.08|-81.55
Shakopee|MN|US|44.8|-93.53
Billerica|MA|US|42.56|-71.27
Norwich|CT|US|41.52|-72.08
Amherst|MA|US|42.37|-72.52
Duncanville|TX|US|32.65|-96.91
New Berlin|WI|US|42.98|-88.11
Marlborough|MA|US|42.35|-71.55
Oakley|CA|US|38|-121.71
Lancaster|OH|US|39.71|-82.6
Sawtelle|CA|US|34.04|-118.45
Avondale|IL|US|41.94|-87.71
Romeoville|IL|US|41.65|-88.09
Culver City|CA|US|34.02|-118.4
Montclair|NJ|US|40.83|-74.21
Meridian|MS|US|32.36|-88.7
Puyallup|WA|US|47.19|-122.29
Woburn|MA|US|42.48|-71.15
Bremerton|WA|US|47.57|-122.63
Hallandale Beach|FL|US|25.98|-80.15
Clovis|NM|US|34.4|-103.21
Weslaco|TX|US|26.16|-97.99
Cape Girardeau|MO|US|37.31|-89.52
Bullhead City|AZ|US|35.15|-114.57
North Fort Myers|FL|US|26.67|-81.88
Dover|DE|US|39.16|-75.52
Chelsea|MA|US|42.39|-71.03
Grove City|OH|US|39.88|-83.09
Princeton|FL|US|25.54|-80.41
Essex|MD|US|39.31|-76.47
Atlantic City|NJ|US|39.36|-74.42
Pacifica|CA|US|37.61|-122.49
Germantown|TN|US|35.09|-89.81
Northglenn|CO|US|39.89|-104.99
Far Rockaway|NY|US|40.61|-73.76
Olney|PA|US|40.04|-75.12
Kensington|NY|US|40.65|-73.97
Coram|NY|US|40.87|-73
Wausau|WI|US|44.96|-89.63
Hurst|TX|US|32.82|-97.17
Stanton|CA|US|33.8|-117.99
Aliamanu / Salt Lakes / Foster Village|HI|US|21.36|-157.92
Lancaster|TX|US|32.59|-96.76
Friendswood|TX|US|29.53|-95.2
Gainesville|GA|US|34.3|-83.82
The Acreage|FL|US|26.79|-80.27
West Oak Lane|PA|US|40.07|-75.17
Montclair|CA|US|34.08|-117.69
Kailua|HI|US|21.4|-157.74
Rock Island|IL|US|41.51|-90.58
Whitney|NV|US|36.1|-115.04
Oviedo|FL|US|28.67|-81.21
Carpentersville|IL|US|42.12|-88.26
Manhattan Valley|NY|US|40.79|-73.97
Lake Oswego|OR|US|45.42|-122.67
Muskogee|OK|US|35.75|-95.37
Hobbs|NM|US|32.7|-103.14
Muskegon|MI|US|43.23|-86.25
Westerville|OH|US|40.13|-82.93
Little Elm|TX|US|33.16|-96.94
Hanover Park|IL|US|42|-88.15
Hillsborough|NJ|US|40.51|-74.67
Channelview|TX|US|29.78|-95.11
Panama City|FL|US|30.16|-85.66
Florence|SC|US|34.2|-79.76
Waipahu|HI|US|21.39|-158.01
Wake Forest|NC|US|35.98|-78.51
Huber Heights|OH|US|39.84|-84.12
Martinez|CA|US|38.02|-122.13
East Meadow|NY|US|40.71|-73.56
Hanover|MD|US|39.19|-76.72
Wheeling|IL|US|42.14|-87.93
Apache Junction|AZ|US|33.42|-111.55
Pleasant Grove|UT|US|40.36|-111.74
Brookfield|WI|US|43.06|-88.11
Columbia Heights|DC|US|38.93|-77.03
Delaware|OH|US|40.3|-83.07
Roy|UT|US|41.16|-112.03
Valley Stream|NY|US|40.66|-73.71
Spanish Fork|UT|US|40.11|-111.65
Keizer|OR|US|44.99|-123.03
Woodlawn|MD|US|39.32|-76.73
Lima|OH|US|40.74|-84.11
Spartanburg|SC|US|34.95|-81.93
Hermitage|TN|US|36.2|-86.62
Park Ridge|IL|US|42.01|-87.84
Fenway/Kenmore|MA|US|42.34|-71.1
Winter Haven|FL|US|28.02|-81.73
Aventura|FL|US|25.96|-80.14
Severna Park|MD|US|39.07|-76.55
Royal Palm Beach|FL|US|26.71|-80.23
Brighton|CO|US|39.99|-104.82
Phenix City|AL|US|32.47|-85
Milton|GA|US|34.13|-84.3
Sun City|AZ|US|33.6|-112.27
Lake Worth Beach|FL|US|26.62|-80.07
Kew Gardens Hills|NY|US|40.73|-73.82
Jamaica Plain|MA|US|42.31|-71.12
Monrovia|CA|US|34.15|-118
Hollister|CA|US|36.85|-121.4
Los Banos|CA|US|37.06|-120.85
Sewell|NJ|US|39.77|-75.14
Plant City|FL|US|28.02|-82.11
Greenfield|WI|US|42.96|-88.01
Marion|IA|US|42.03|-91.6
Braintree|MA|US|42.2|-71
Newnan|GA|US|33.38|-84.8
Texarkana|TX|US|33.43|-94.05
Banjul|Banjul|GM|13.45|-16.58
Addison|IL|US|41.93|-87.99
Reynoldsburg|OH|US|39.95|-82.81
South Jordan Heights|UT|US|40.56|-111.95
Odenton|MD|US|39.08|-76.7
Mableton|GA|US|33.82|-84.58
Hilton Head|SC|US|32.22|-80.75
Grants Pass|OR|US|42.44|-123.33
Indian Trail|NC|US|35.08|-80.67
Calumet City|IL|US|41.62|-87.53
Lincoln Park|MI|US|42.25|-83.18
Lynnwood|WA|US|47.82|-122.32
Whitestone|NY|US|40.79|-73.82
Beloit|WI|US|42.51|-89.03
Belleville|NJ|US|40.79|-74.15
Longview|WA|US|46.14|-122.94
Columbia|TN|US|35.62|-87.04
South Miami Heights|FL|US|25.6|-80.38
Portage|IN|US|41.58|-87.18
Westfield|IN|US|40.04|-86.13
New Albany|IN|US|38.29|-85.82
Clifton Park|NY|US|42.87|-73.77
Fort Lee|NJ|US|40.85|-73.97
Brighton|NY|US|43.15|-77.55
Bartlesville|OK|US|36.75|-95.98
Ewing|NJ|US|40.27|-74.8
San Juan|TX|US|26.19|-98.16
Woodhaven|NY|US|40.69|-73.86
Mission Bend|TX|US|29.69|-95.66
San Juan Capistrano|CA|US|33.5|-117.66
Pahrump|NV|US|36.21|-115.98
Saint Charles|MD|US|38.6|-76.94
Temple City|CA|US|34.11|-118.06
Marion|OH|US|40.59|-83.13
Mechanicsville|VA|US|37.61|-77.37
Lufkin|TX|US|31.34|-94.73
Pennsauken|NJ|US|39.96|-75.06
Rome|GA|US|34.26|-85.16
Mattapan|MA|US|42.27|-71.09
Claremont|CA|US|34.1|-117.72
Franklin|WI|US|42.89|-88.04
West Hollywood|CA|US|34.09|-118.36
Richfield|MN|US|44.88|-93.28
Bell|CA|US|33.98|-118.19
Lewiston|ME|US|44.1|-70.21
Dunedin|FL|US|28.02|-82.77
Kendall West|FL|US|25.71|-80.44
Del Rio|TX|US|29.36|-100.9
Oakville|MO|US|38.47|-90.3
Commack|NY|US|40.84|-73.29
Menomonee Falls|WI|US|43.18|-88.12
Moorpark|CA|US|34.29|-118.88
Gadsden|AL|US|34.01|-86.01
Issaquah|WA|US|47.53|-122.03
Spring Hill|TN|US|35.75|-86.93
Trumbull|CT|US|41.24|-73.2
Olive Branch|MS|US|34.96|-89.83
Mooresville|NC|US|35.58|-80.81
West Torrington|CT|US|41.82|-73.14
Willowbrook|CA|US|33.92|-118.26
Leavenworth|KS|US|39.31|-94.92
Clinton|MD|US|38.77|-76.9
Cottage Grove|MN|US|44.83|-92.94
Port-Vila|Shefa|VU|-17.74|168.31
Wildwood|MO|US|38.58|-90.66
Richmond West|FL|US|25.61|-80.43
Richmond|IN|US|39.83|-84.89
Mount Pleasant|DC|US|38.93|-77.04
Oregon City|OR|US|45.36|-122.61
'Ewa Gentry-West Loch|HI|US|21.35|-158.03
Goldsboro|NC|US|35.38|-77.99
Manhattan Beach|CA|US|33.88|-118.41
Parkland|WA|US|47.16|-122.43
Martinez|GA|US|33.52|-82.08
East Florence|AL|US|34.81|-87.65
Kyle|TX|US|29.99|-97.88
Kearns|UT|US|40.66|-112
Linton Hall|VA|US|38.76|-77.57
Tupelo|MS|US|34.26|-88.7
Hot Springs|AR|US|34.5|-93.06
Wildomar|CA|US|33.6|-117.28
Wentzville|MO|US|38.81|-90.85
Roseville|MN|US|45.01|-93.16
Valrico|FL|US|27.94|-82.24
Coventry|RI|US|41.7|-71.68
Rosenberg|TX|US|29.56|-95.81
Bettendorf|IA|US|41.52|-90.52
East Point|GA|US|33.68|-84.44
Prattville|AL|US|32.46|-86.46
Ponte Vedra Beach|FL|US|30.24|-81.39
Boardman|OH|US|41.02|-80.66
Cooper City|FL|US|26.06|-80.27
Oxon Hill-Glassmanor|MD|US|38.8|-76.97
Egypt Lake-Leto|FL|US|28.02|-82.51
North Lawndale|IL|US|41.86|-87.72
Oak Creek|WI|US|42.89|-87.86
Peachtree City|GA|US|33.4|-84.6
Merrillville|IN|US|41.48|-87.33
Saint Cloud|FL|US|28.25|-81.28
La Porte|TX|US|29.67|-95.02
University City|MO|US|38.66|-90.31
Upper Arlington|OH|US|39.99|-83.06
Torrington|CT|US|41.8|-73.12
Beverly Hills|CA|US|34.07|-118.4
Inver Grove Heights|MN|US|44.85|-93.04
Cumberland|RI|US|41.97|-71.43
Bayview-Hunters Point|CA|US|37.73|-122.38
Pleasant Hill|CA|US|37.95|-122.06
Stow|OH|US|41.16|-81.44
Lauderdale Lakes|FL|US|26.17|-80.21
La Vergne|TN|US|36.02|-86.58
Winter Springs|FL|US|28.7|-81.31
Merritt Island|FL|US|28.36|-80.69
Greenpoint|NY|US|40.72|-73.95
West Little River|FL|US|25.86|-80.24
Brunswick|OH|US|41.24|-81.84
San Dimas|CA|US|34.11|-117.81
Monroe|NC|US|34.99|-80.55
North Center|IL|US|41.95|-87.68
Queen Creek|AZ|US|33.25|-111.63
Kaneohe|HI|US|21.4|-157.8
Gahanna|OH|US|40.02|-82.88
Leawood|KS|US|38.97|-94.62
Owasso|OK|US|36.27|-95.85
Derry Village|NH|US|42.89|-71.31
Orange|NJ|US|40.77|-74.23
Central Islip|NY|US|40.79|-73.2
Norristown|PA|US|40.12|-75.34
Lower West Side|IL|US|41.85|-87.67
Dyker Heights|NY|US|40.62|-74.01
Glendale|NY|US|40.7|-73.89
Cottonwood Heights|UT|US|40.62|-111.81
Gallatin|TN|US|36.39|-86.45
Houma|LA|US|29.6|-90.72
Rubidoux|CA|US|34|-117.41
Collinwood|OH|US|41.56|-81.57
Glendale Heights|IL|US|41.91|-88.06
Butte|MT|US|46|-112.53
Dana Point|CA|US|33.47|-117.7
Benton|AR|US|34.56|-92.59
Vestavia Hills|AL|US|33.45|-86.79
La Presa|CA|US|32.71|-117
Oakton|VA|US|38.88|-77.3
Chester|PA|US|39.85|-75.36
Mount Vernon|WA|US|48.42|-122.33
Studio City|CA|US|34.15|-118.4
Salisbury|NC|US|35.67|-80.47
Riviera Beach|FL|US|26.78|-80.06
Orangevale|CA|US|38.68|-121.23
Oswego|IL|US|41.68|-88.35
El Mirage|AZ|US|33.61|-112.32
West Lake Sammamish|WA|US|47.58|-122.1
North Bel Air|MD|US|39.54|-76.35
Chelmsford|MA|US|42.6|-71.37
Bay City|MI|US|43.59|-83.89
Nacogdoches|TX|US|31.6|-94.66
Shrewsbury|MA|US|42.3|-71.71
McMinnville|OR|US|45.21|-123.2
Dakota Ridge|CO|US|39.62|-105.14
Bridgeport|IL|US|41.84|-87.65
Dalton|GA|US|34.77|-84.97
Olney|MD|US|39.15|-77.07
North Providence|RI|US|41.85|-71.47
Newark|DE|US|39.68|-75.75
Oak Hill|VA|US|38.93|-77.4
Deer Park|TX|US|29.71|-95.12
Holland|MI|US|42.79|-86.11
Throgs Neck|NY|US|40.82|-73.82
Northbrook|IL|US|42.13|-87.83
Hilliard|OH|US|40.03|-83.16
Wenatchee|WA|US|47.42|-120.31
West Fargo|ND|US|46.87|-96.9
Fair Lawn|NJ|US|40.94|-74.13
Kennesaw|GA|US|34.02|-84.62
New City|NY|US|41.15|-73.99
Long Beach|NY|US|40.59|-73.66
Richmond|KY|US|37.75|-84.29
Suitland-Silver Hill|MD|US|38.85|-76.93
Chillum|MD|US|38.96|-76.99
Foster City|CA|US|37.56|-122.27
Fairborn|OH|US|39.82|-84.02
Menlo Park|CA|US|37.45|-122.18
Chicago Loop|IL|US|41.88|-87.63
Cibolo|TX|US|29.56|-98.23
Lawndale|CA|US|33.89|-118.35
Hinesville|GA|US|31.85|-81.6
Waxahachie|TX|US|32.39|-96.85
St. Charles|MD|US|38.61|-76.92
Cobbs Creek|PA|US|39.95|-75.24
Woodridge|IL|US|41.75|-88.05
Carrollwood|FL|US|28.05|-82.49
Somerton|PA|US|40.12|-75.01
Elk Grove Village|IL|US|42|-87.97
Pekin|IL|US|40.57|-89.64
Socorro|TX|US|31.65|-106.3
Elmont|NY|US|40.7|-73.71
Adelanto|CA|US|34.58|-117.41
Tooele|UT|US|40.53|-112.3
Golden Glades|FL|US|25.91|-80.2
Marrero|LA|US|29.9|-90.1
Jackson|MI|US|42.25|-84.4
Foothill Farms|CA|US|38.68|-121.35
Englewood|CO|US|39.65|-104.99
Copperas Cove|TX|US|31.12|-97.9
Bath Beach|NY|US|40.6|-74
Huntington Station|NY|US|40.85|-73.41
Seaside|CA|US|36.61|-121.85
Kearney|NE|US|40.7|-99.08
Redan|GA|US|33.75|-84.13
Manitowoc|WI|US|44.09|-87.66
Williamsburg|NY|US|40.71|-73.95
Goshen|IN|US|41.58|-85.83
St. Charles|IL|US|41.91|-88.31
Monaco|Municipality of Monaco|MC|43.74|7.42
Greenacres City|FL|US|26.62|-80.13
Kiryas Joel|NY|US|41.34|-74.17
Salisbury|MD|US|38.36|-75.6
Douglasville|GA|US|33.75|-84.75
Silver Lake|CA|US|34.09|-118.27
Security-Widefield|CO|US|38.75|-104.71
University Place|WA|US|47.24|-122.55
Pullman|WA|US|46.73|-117.18
West Lawn|IL|US|41.77|-87.72
Mount Lebanon|PA|US|40.36|-80.05
Windsor|CO|US|40.48|-104.9
Alabaster|AL|US|33.24|-86.82
Farmers Branch|TX|US|32.93|-96.9
Oildale|CA|US|35.42|-119.02
La Verne|CA|US|34.1|-117.77
Mason|OH|US|39.36|-84.31
Eastpointe|MI|US|42.47|-82.96
Bustleton|PA|US|40.08|-75.03
Gillette|WY|US|44.29|-105.5
Valparaiso|IN|US|41.47|-87.06
Midvale|UT|US|40.61|-111.9
Spring Valley|NY|US|41.11|-74.04
Rome|NY|US|43.21|-75.46
Lewiston|ID|US|46.42|-117.02
West Village|NY|US|40.73|-74.01
North Ridgeville|OH|US|41.39|-82.02
Petersburg|VA|US|37.23|-77.4
Santa Rosa Beach|FL|US|30.4|-86.23
Ken Caryl|CO|US|39.58|-105.11
Randallstown|MD|US|39.37|-76.8
Westlake|OH|US|41.46|-81.92
Bangor|ME|US|44.8|-68.77
Clermont|FL|US|28.55|-81.77
Sun Prairie|WI|US|43.18|-89.21
Georgetown|KY|US|38.21|-84.56
Greater Grand Crossing|IL|US|41.76|-87.61
Fairbanks|AK|US|64.84|-147.72
College Park|MD|US|38.98|-76.94
Springville|UT|US|40.17|-111.61
Natick|MA|US|42.28|-71.35
Massillon|OH|US|40.8|-81.52
Walla Walla|WA|US|46.06|-118.34
Florence|KY|US|39|-84.63
Andover|MN|US|45.23|-93.29
Hopkinsville|KY|US|36.87|-87.49
Overbrook|PA|US|39.99|-75.24
Laramie|WY|US|41.31|-105.59
Greenville|MS|US|33.41|-91.06
West Englewood|IL|US|41.78|-87.67
Bethel Park|PA|US|40.33|-80.04
Cookeville|TN|US|36.16|-85.5
Randolph|MA|US|42.16|-71.04
Oceanside|NY|US|40.64|-73.64
Danville|IL|US|40.12|-87.63
Helena|MT|US|46.59|-112.04
Montgomery Village|MD|US|39.18|-77.2
North Olmsted|OH|US|41.42|-81.92
Land O' Lakes|FL|US|28.22|-82.46
Watertown|MA|US|42.37|-71.18
Glastonbury|CT|US|41.71|-72.61
Westmont|CA|US|33.94|-118.3
Hyde Park|MA|US|42.26|-71.12
Garfield|NJ|US|40.88|-74.11
Laguna Hills|CA|US|33.61|-117.71
West Bend|WI|US|43.43|-88.18
Willingboro|NJ|US|40.03|-74.87
Cicero|NY|US|43.18|-76.12
Mundelein|IL|US|42.26|-88
Centereach|NY|US|40.86|-73.1
Juneau|AK|US|58.3|-134.42
Mount Juliet|TN|US|36.2|-86.52
Naugatuck|CT|US|41.49|-73.05
San Luis|AZ|US|32.49|-114.78
Brighton Beach|NY|US|40.58|-73.96
Michigan City|IN|US|41.71|-86.9
Dania Beach|FL|US|26.05|-80.14
Makiki / Lower Punchbowl / Tantalus|HI|US|21.32|-157.83
Lewiston Orchards|ID|US|46.38|-116.98
Lexington|MA|US|42.45|-71.22
Chatham|IL|US|41.74|-87.61
Navarre|FL|US|30.4|-86.86
Holly Springs|NC|US|35.65|-78.83
Shawnee|OK|US|35.33|-96.93
Brentwood Estates|TN|US|36.03|-86.78
Galesburg|IL|US|40.95|-90.37
Bowling Green|OH|US|41.37|-83.65
Des Moines|WA|US|47.4|-122.32
Wheat Ridge|CO|US|39.77|-105.08
Florence|AZ|US|33.03|-111.39
Gurnee|IL|US|42.37|-87.9
Myrtle Beach|SC|US|33.69|-78.89
Parkersburg|WV|US|39.27|-81.56
Miami Lakes|FL|US|25.91|-80.31
Saratoga|CA|US|37.26|-122.02
East Lake|FL|US|28.11|-82.69
Banning|CA|US|33.93|-116.88
Goleta|CA|US|34.44|-119.83
Lakeside|FL|US|30.13|-81.77
Long Branch|NJ|US|40.3|-73.99
Fair Oaks|CA|US|38.64|-121.27
Wayne|PA|US|40.04|-75.39
Lake Stevens|WA|US|48.02|-122.06
Dover|NH|US|43.2|-70.87
Radnor|PA|US|40.05|-75.36
Holladay|UT|US|40.67|-111.82
Herriman|UT|US|40.51|-112.03
South Kingstown|RI|US|41.45|-71.52
Estero|FL|US|26.44|-81.81
Ithaca|NY|US|42.44|-76.5
North Tonawanda|NY|US|43.04|-78.86
Brooklyn Center|MN|US|45.08|-93.33
Pikesville|MD|US|39.37|-76.72
New Iberia|LA|US|30|-91.82
Alamogordo|NM|US|32.9|-105.96
Parkville|MD|US|39.38|-76.54
Statesboro|GA|US|32.45|-81.78
Morgantown|WV|US|39.63|-79.96
Los Gatos|CA|US|37.23|-121.97
Matthews|NC|US|35.12|-80.72
Los Altos|CA|US|37.39|-122.11
Clearfield|UT|US|41.11|-112.03
Franklin|MA|US|42.08|-71.4
Owings Mills|MD|US|39.42|-76.78
Hawai'i Kai|HI|US|21.3|-157.7
Aiken|SC|US|33.56|-81.72
Plainfield|IN|US|39.7|-86.4
Ballwin|MO|US|38.6|-90.55
Manchester|CT|US|41.78|-72.52
Algonquin|IL|US|42.17|-88.29
Bel Air North|MD|US|39.55|-76.37
Newington|CT|US|41.7|-72.72
Westfield|NJ|US|40.66|-74.35
Santa Paula|CA|US|34.35|-119.06
Fallbrook|CA|US|33.38|-117.25
Eldersburg|MD|US|39.4|-76.95
Sherwood|AR|US|34.82|-92.22
Springfield Gardens|NY|US|40.66|-73.76
Lawrenceville|GA|US|33.96|-83.99
Springfield|VA|US|38.79|-77.19
Kaysville|UT|US|41.04|-111.94
Granger|IN|US|41.75|-86.11
Burlingame|CA|US|37.58|-122.37
Post Falls|ID|US|47.72|-116.95
Liberty|MO|US|39.25|-94.42
West Roxbury|MA|US|42.28|-71.15
San Pablo|CA|US|37.96|-122.35
Savage|MN|US|44.78|-93.34
Poughkeepsie|NY|US|41.7|-73.92
Texarkana|AR|US|33.44|-94.04
North Royalton|OH|US|41.31|-81.72
Chicago Heights|IL|US|41.51|-87.64
Lebanon|TN|US|36.21|-86.29
Walnut|CA|US|34.02|-117.87
Madison Heights|MI|US|42.49|-83.11
DeLand|FL|US|29.03|-81.3
Cedar City|UT|US|37.68|-113.06
Parkland|FL|US|26.31|-80.24
West Warwick|RI|US|41.7|-71.52
Jamestown|NY|US|42.1|-79.24
New Bern|NC|US|35.11|-77.04
Rochester|NH|US|43.3|-70.98
Cleburne|TX|US|32.35|-97.39
Ashmont|MA|US|42.28|-71.07
Eagle Foothills|ID|US|43.74|-116.39
Oranjestad||AW|12.52|-70.03
Winter Park|FL|US|28.6|-81.34
Carney|MD|US|39.39|-76.52
Southlake|TX|US|32.94|-97.13
San Carlos|CA|US|37.51|-122.26
Woodstock|GA|US|34.1|-84.52
East Hill-Meridian|WA|US|47.41|-122.17
Niles|IL|US|42.02|-87.8
Laplace|LA|US|30.07|-90.48
Westchester|FL|US|25.75|-80.33
Atascadero|CA|US|35.49|-120.67
Kent|OH|US|41.15|-81.36
Gloucester|MA|US|42.61|-70.66
Nicholasville|KY|US|37.88|-84.57
Oak Park|MI|US|42.46|-83.18
Highland Park|IL|US|42.18|-87.8
Elizabethtown|KY|US|37.69|-85.86
Austintown|OH|US|41.1|-80.76
East Palo Alto|CA|US|37.47|-122.14
South Gate|MD|US|39.13|-76.63
Pueblo West|CO|US|38.35|-104.72
Port Chester|NY|US|41|-73.67
Princeton|NJ|US|40.35|-74.66
Fort Cavazos|TX|US|31.13|-97.78
LaGrange|GA|US|33.04|-85.03
Salem|NH|US|42.79|-71.2
Opelika|AL|US|32.65|-85.38
Rahway|NJ|US|40.61|-74.28
North Chicago|IL|US|42.33|-87.84
Middle Village|NY|US|40.72|-73.88
Morristown|TN|US|36.21|-83.29
Cheshire|CT|US|41.5|-72.9
Branford|CT|US|41.28|-72.82
Raytown|MO|US|39.01|-94.46
George Town|George Town|KY|19.29|-81.37
Fruit Cove|FL|US|30.11|-81.64
Port Huron|MI|US|42.97|-82.42
Tewksbury|MA|US|42.61|-71.23
Glenville|NY|US|42.93|-74.05
Franklin Square|NY|US|40.71|-73.68
Oak Ridge|TN|US|36.01|-84.27
Longfellow Community|MN|US|44.94|-93.23
Southgate|MI|US|42.21|-83.19
East Haven|CT|US|41.28|-72.87
Upper Alton|IL|US|38.91|-90.15
Johnston|RI|US|41.82|-71.51
Atwater|CA|US|37.35|-120.61
West Falls Church|VA|US|38.86|-77.19
Williamsport|PA|US|41.24|-77
Duluth|GA|US|34|-84.14
Fort Bragg|NC|US|35.14|-79.01
Russellville|AR|US|35.28|-93.13
Sanford|NC|US|35.48|-79.18
Harker Heights|TX|US|31.08|-97.66
Burbank|IL|US|41.73|-87.78
Marion|IN|US|40.56|-85.66
Granite City|IL|US|38.7|-90.15
Milford Mill|MD|US|39.35|-76.77
Lake in the Hills|IL|US|42.18|-88.33
Evans|GA|US|33.53|-82.13
O'Fallon|IL|US|38.59|-89.91
Fort Hamilton|NY|US|40.62|-74.03
Carlsbad|NM|US|32.42|-104.23
Ferry Pass|FL|US|30.51|-87.21
Airport|HI|US|21.34|-157.93
Kingman|AZ|US|35.19|-114.05
Orcutt|CA|US|34.87|-120.44
Henderson|KY|US|37.84|-87.59
Needham|MA|US|42.28|-71.23
Crown Point|IN|US|41.42|-87.37
Big Spring|TX|US|32.25|-101.48
Dracut|MA|US|42.67|-71.3
Allston|MA|US|42.36|-71.13
Schererville|IN|US|41.48|-87.45
Burton|MI|US|43|-83.62
Ridgecrest|CA|US|35.62|-117.67
Windsor|CT|US|41.85|-72.64
Eagle Pass|TX|US|28.71|-100.5
Agawam|MA|US|42.07|-72.61
Weatherford|TX|US|32.76|-97.8
West Elkridge|MD|US|39.21|-76.73
East Chicago|IN|US|41.64|-87.45
Redmond|OR|US|44.27|-121.17
Jacksonville|AR|US|34.87|-92.11
Socorro Mission Number 1 Colonia|TX|US|31.64|-106.29
Norwood|MA|US|42.19|-71.2
Northampton|MA|US|42.33|-72.64
Englewood|NJ|US|40.89|-73.97
Lake Magdalene|FL|US|28.07|-82.47
Perry Hall|MD|US|39.41|-76.46
Maryville|TN|US|35.76|-83.97
Hobart|IN|US|41.53|-87.26
Fresh Meadows|NY|US|40.73|-73.79
Frankfort|KY|US|38.2|-84.87
Mehlville|MO|US|38.51|-90.32
Greer|SC|US|34.94|-82.23
Lansing|IL|US|41.56|-87.54
Harrison|NY|US|40.97|-73.71
Monterey|CA|US|36.6|-121.89
West Islip|NY|US|40.71|-73.31
Desert Hot Springs|CA|US|33.96|-116.5
American Fork|UT|US|40.38|-111.8
Central|LA|US|30.55|-91.04
Newburgh|NY|US|41.5|-74.01
McCully - Moiliili|HI|US|21.29|-157.83
Chamblee|GA|US|33.89|-84.3
Millville|NJ|US|39.4|-75.04
North Andover|MA|US|42.7|-71.14
SeaTac|WA|US|47.45|-122.29
Elmira|NY|US|42.09|-76.81
Spring Valley|CA|US|32.74|-117
Stockbridge|GA|US|33.54|-84.23
Glen Ellyn|IL|US|41.88|-88.07
Monroeville|PA|US|40.42|-79.79
Benicia|CA|US|38.05|-122.16
Fredericksburg|VA|US|38.3|-77.46
Suisun|CA|US|38.24|-122.04
Aberdeen|SD|US|45.46|-98.49
Cranberry Township|PA|US|40.68|-80.11
Garfield Heights|OH|US|41.42|-81.61
South Chicago|IL|US|41.74|-87.55
Cornelius|NC|US|35.49|-80.86
Oakdale|MN|US|44.96|-92.96
Oak Forest|IL|US|41.6|-87.74
Garner|NC|US|35.71|-78.61
Holmesburg|PA|US|40.04|-75.03
Drexel Hill|PA|US|39.95|-75.29
Vestal|NY|US|42.09|-76.05
North Kingstown|RI|US|41.55|-71.47
Saint Helier|St Helier|JE|49.19|-2.1
Bella Vista|AR|US|36.48|-94.27
Melrose|MA|US|42.46|-71.07
Fitchburg|WI|US|42.96|-89.47
Gramercy Park|NY|US|40.74|-73.99
Wellesley|MA|US|42.3|-71.29
Enterprise|AL|US|31.32|-85.86
Winchester|NV|US|36.13|-115.12
Slidell|LA|US|30.28|-89.78
University Heights|NY|US|40.86|-73.91
West Springfield|MA|US|42.11|-72.62
Dodge City|KS|US|37.75|-100.02
Paragould|AR|US|36.06|-90.5
Maywood|CA|US|33.99|-118.19
Seguin|TX|US|29.57|-97.96
Shirley|NY|US|40.8|-72.87
Livingston|NJ|US|40.8|-74.31
Round Lake Beach|IL|US|42.37|-88.09
Sterling|VA|US|39.01|-77.43
Middletown|NY|US|41.45|-74.42
Fountain|CO|US|38.68|-104.7
Saratoga Springs|NY|US|43.08|-73.78
Kirkwood|MO|US|38.58|-90.41
Drexel Heights|AZ|US|32.14|-111.03
Deer Park|NY|US|40.76|-73.33
Lafayette|CO|US|39.99|-105.09
Fridley|MN|US|45.09|-93.26
West Scarborough|ME|US|43.57|-70.39
Queensbury|NY|US|43.38|-73.61
Roslindale|MA|US|42.29|-71.12
Rexburg|ID|US|43.83|-111.79
Wheeling|WV|US|40.06|-80.72
Shaker Heights|OH|US|41.47|-81.54
Mililani Town|HI|US|21.45|-158.02
Bergenfield|NJ|US|40.93|-74
Marshalltown|IA|US|42.05|-92.91
Tucker|GA|US|33.85|-84.22
Nutley|NJ|US|40.82|-74.16
Port Richmond|PA|US|39.99|-75.1
Lake Jackson|TX|US|29.03|-95.43
Plum|PA|US|40.5|-79.75
Windsor|CA|US|38.55|-122.82
West Chicago|IL|US|41.88|-88.2
Allen Park|MI|US|42.26|-83.21
Wilmette|IL|US|42.07|-87.72
Imperial Beach|CA|US|32.58|-117.11
Glen Cove|NY|US|40.86|-73.63
Syracuse|UT|US|41.09|-112.06
Maryland Heights|MO|US|38.71|-90.43
Mason City|IA|US|43.15|-93.2
Crofton|MD|US|39|-76.69
Anderson|SC|US|34.5|-82.65
Eagle Mountain|UT|US|40.31|-112.01
College Point|NY|US|40.79|-73.85
Winchester|VA|US|39.19|-78.16
Lindenhurst|NY|US|40.69|-73.37
Spanaway|WA|US|47.1|-122.43
Belmont|CA|US|37.52|-122.28
Hunts Point|NY|US|40.81|-73.88
Holbrook|NY|US|40.81|-73.08
New London|CT|US|41.36|-72.1
Paso Robles|CA|US|35.63|-120.69
Tualatin|OR|US|45.38|-122.76
Fleming Island|FL|US|30.09|-81.72
Winona|MN|US|44.05|-91.64
Agua Caliente|CA|US|38.32|-122.49
Thomasville|NC|US|35.88|-80.08
Casselberry|FL|US|28.68|-81.33
Eureka|CA|US|40.8|-124.16
East Saint Louis|IL|US|38.62|-90.15
Garden City|KS|US|37.97|-100.87
Alton|IL|US|38.89|-90.18
Milton|MA|US|42.25|-71.07
University Park|FL|US|25.75|-80.37
Auburn|NY|US|42.93|-76.57
Williston|ND|US|48.15|-103.62
Paramus|NJ|US|40.94|-74.08
Back Mountain|PA|US|41.34|-76
West Milford|NJ|US|41.13|-74.37
Jeffersontown|KY|US|38.19|-85.56
Garden City|MI|US|42.33|-83.33
Horn Lake|MS|US|34.96|-90.03
Stoughton|MA|US|42.13|-71.1
Easton|PA|US|40.69|-75.22
Prairieville|LA|US|30.3|-90.97
Hyde Park|IL|US|41.79|-87.59
Dix Hills|NY|US|40.8|-73.34
Gladstone|MO|US|39.2|-94.55
Cutler Ridge|FL|US|25.58|-80.35
Independence|KY|US|38.94|-84.54
Watertown|NY|US|43.97|-75.91
Wooster|OH|US|40.81|-81.94
Bessemer|AL|US|33.4|-86.95
Merrimack|NH|US|42.87|-71.49
Lemon Grove|CA|US|32.74|-117.03
Kankakee|IL|US|41.12|-87.86
Wethersfield|CT|US|41.71|-72.65
Bristol|TN|US|36.6|-82.19
McHenry|IL|US|42.33|-88.27
Saugus|MA|US|42.46|-71.01
Stevens Point|WI|US|44.52|-89.57
West Linn|OR|US|45.37|-122.61
Superior|WI|US|46.72|-92.1
Gibraltar||GI|36.14|-5.35
Tujunga|CA|US|34.25|-118.29
Greenville|TX|US|33.14|-96.11
Magna|UT|US|40.71|-112.1
Batavia|IL|US|41.85|-88.31
Cantonment|FL|US|30.61|-87.34
Danvers|MA|US|42.58|-70.93
Shoreview|MN|US|45.08|-93.15
Paradise|CA|US|39.76|-121.62
Fremont|NE|US|41.43|-96.5
Smithtown|NY|US|40.86|-73.2
Pearl|MS|US|32.27|-90.13
Mansfield City|CT|US|41.77|-72.23
Mercerville-Hamilton Square|NJ|US|40.23|-74.67
North Creek|WA|US|47.82|-122.18
Carbondale|IL|US|37.73|-89.22
Westport|CT|US|41.14|-73.36
Papeete|Iles du Vent|PF|-17.53|-149.57
Medina|OH|US|41.14|-81.86
Bay Shore|NY|US|40.73|-73.25
Kahului|HI|US|20.89|-156.47
Leisure City|FL|US|25.5|-80.43
Vernon Hills|IL|US|42.22|-87.98
Zionsville|IN|US|39.95|-86.26
Norco|CA|US|33.93|-117.55
Wasco|CA|US|35.59|-119.34
Mount Pleasant|WI|US|42.7|-87.86
Fortuna Foothills|AZ|US|32.66|-114.41
Barberton|OH|US|41.01|-81.61
Kingsville|TX|US|27.52|-97.86
Statesville|NC|US|35.78|-80.89
Douglas|Douglas|IM|54.15|-4.48
Plainview|NY|US|40.78|-73.47
Laurel|MD|US|39.1|-76.85
Carrollton|GA|US|33.58|-85.08
South Pasadena|CA|US|34.12|-118.15
Howard Beach|NY|US|40.66|-73.84
Englewood|IL|US|41.78|-87.65
Four Corners|FL|US|28.33|-81.65
South Laurel|MD|US|39.07|-76.85
Asheboro|NC|US|35.71|-79.81
Buenaventura Lakes|FL|US|28.34|-81.35
Clinton|IA|US|41.84|-90.19
Mount Pleasant|MI|US|43.6|-84.77
Twentynine Palms|CA|US|34.14|-116.05
Huntley|IL|US|42.17|-88.43
Pennsport|PA|US|39.93|-75.15
Xenia|OH|US|39.68|-83.93
Reisterstown|MD|US|39.47|-76.83
Central 14th Street / Spring Road|DC|US|38.94|-77.03
Green|OH|US|40.95|-81.48
Brawley|CA|US|32.98|-115.53
Yukon|OK|US|35.51|-97.76
Ellendale|TN|US|35.23|-89.83
Opportunity|WA|US|47.65|-117.24
Forest Hills|MI|US|42.96|-85.49
Lafayette|CA|US|37.89|-122.12
Ramsey|MN|US|45.26|-93.45
Suitland|MD|US|38.85|-76.92
Pleasure Ridge Park|KY|US|38.15|-85.86
Rosedale|NY|US|40.66|-73.74
New Lenox|IL|US|41.51|-87.97
Madison|MS|US|32.46|-90.12
Neenah|WI|US|44.19|-88.46
Alvin|TX|US|29.42|-95.24
Key West|FL|US|24.56|-81.78
Randolph|NJ|US|40.85|-74.58
Temple Terrace|FL|US|28.04|-82.39
Owatonna|MN|US|44.08|-93.23
Homewood|AL|US|33.47|-86.8
Sahuarita|AZ|US|31.96|-110.96
Maple Valley|WA|US|47.39|-122.05
Hazelwood|MO|US|38.77|-90.37
Troy|OH|US|40.04|-84.2
Lemoore|CA|US|36.3|-119.78
Mint Hill|NC|US|35.18|-80.65
Ridgewood|NJ|US|40.98|-74.12
Long Island City|NY|US|40.74|-73.95
Cabot|AR|US|34.97|-92.02
Rhawnhurst|PA|US|40.06|-75.06
Reedley|CA|US|36.6|-119.45
Edgewood|MD|US|39.42|-76.29
Meadow Woods|FL|US|28.39|-81.37
South Portland|ME|US|43.64|-70.24
West Whittier-Los Nietos|CA|US|33.98|-118.07
Lebanon|PA|US|40.34|-76.41
Zanesville|OH|US|39.94|-82.01
Colleyville|TX|US|32.88|-97.16
Canton|GA|US|34.24|-84.49
Ossining|NY|US|41.16|-73.86
Salem|VA|US|37.29|-80.05
Burlington|IA|US|40.81|-91.11
Saratoga Springs|UT|US|40.35|-111.9
Majuro|Majuro Atoll|MH|7.09|171.38
Melrose Park|IL|US|41.9|-87.86
Starkville|MS|US|33.45|-88.82
Lochearn|MD|US|39.34|-76.72
Chanhassen|MN|US|44.86|-93.53
Hercules|CA|US|38.02|-122.29
Galt|CA|US|38.25|-121.3
Prior Lake|MN|US|44.71|-93.42
Castlewood|CO|US|39.58|-104.9
Grandview|MO|US|38.89|-94.53
Clinton|MS|US|32.34|-90.32
Yarmouth|MA|US|41.71|-70.23
Sandusky|OH|US|41.45|-82.71
Balch Springs|TX|US|32.73|-96.62
White Bear Lake|MN|US|45.08|-93.01
Chaska|MN|US|44.79|-93.6
Harvey|IL|US|41.61|-87.65
Middle River|MD|US|39.33|-76.44
Woodstock|IL|US|42.31|-88.45
Ardmore|OK|US|34.17|-97.14
Lockport|IL|US|41.59|-88.06
Woodburn|OR|US|45.14|-122.86
Wyandotte|MI|US|42.21|-83.15
Mauldin|SC|US|34.78|-82.31
Belvidere|IL|US|42.26|-88.84
Moscow|ID|US|46.73|-117
Milford|MA|US|42.14|-71.52
West Memphis|AR|US|35.15|-90.18
Athens|OH|US|39.33|-82.1
Mercer Island|WA|US|47.57|-122.22
Bridgeton|NJ|US|39.43|-75.23
Maplewood|NJ|US|40.73|-74.27
Soledad|CA|US|36.42|-121.33
Farmington|CT|US|41.72|-72.83
Brownsburg|IN|US|39.84|-86.4
Saginaw Township North|MI|US|43.46|-84.01
Edwardsville|IL|US|38.81|-89.95
Riverside|OH|US|39.78|-84.12
Athens|AL|US|34.8|-86.97
Woodbridge|CA|US|33.68|-117.79
Liliha - Kapalama|HI|US|21.34|-157.85
Sanger|CA|US|36.71|-119.56
Westmont|IL|US|41.8|-87.98
Wakefield|MA|US|42.51|-71.07
San Fernando|CA|US|34.28|-118.44
Rockledge|FL|US|28.35|-80.73
Hastings|NE|US|40.59|-98.39
Cave Spring|VA|US|37.23|-80.01
North Tustin|CA|US|33.76|-117.79
East Amherst|NY|US|43.02|-78.7
Daphne|AL|US|30.6|-87.9
Whitehall Township|PA|US|40.67|-75.5
Paducah|KY|US|37.08|-88.6
Cliffside Park|NJ|US|40.82|-73.99
Elmwood Park|IL|US|41.92|-87.81
Vineyard|CA|US|38.46|-121.35
Lodi|NJ|US|40.88|-74.08
Hazleton|PA|US|40.96|-75.97
Coronado|CA|US|32.69|-117.18
Hillside|NY|US|40.71|-73.79
Eagle River|AK|US|61.32|-149.57
South Salt Lake|UT|US|40.72|-111.89
Paris|TX|US|33.66|-95.56
Mo'ili'ili|HI|US|21.29|-157.83
Northport|AL|US|33.23|-87.58
University Park|TX|US|32.85|-96.8
Uniondale|NY|US|40.7|-73.59
Ponca City|OK|US|36.71|-97.09
Muskego|WI|US|42.91|-88.14
Collinsville|IL|US|38.67|-89.98
Reading|MA|US|42.53|-71.1
Short Pump|VA|US|37.65|-77.61
Belmont|MA|US|42.4|-71.18
Dedham|MA|US|42.24|-71.17
De Pere|WI|US|44.45|-88.06
Caledonia|WI|US|42.81|-87.92
Inkster|MI|US|42.29|-83.31
Vincentown|NJ|US|39.93|-74.75
Bixby|OK|US|35.94|-95.88
Emporia|KS|US|38.4|-96.18
Fort Dodge|IA|US|42.5|-94.17
Walker|MI|US|43|-85.77
Ottumwa|IA|US|41.02|-92.41
Junction City|KS|US|39.03|-96.83
Seal Beach|CA|US|33.74|-118.1
Tarpon Springs|FL|US|28.15|-82.76
Franklin|IN|US|39.48|-86.05
Herndon|VA|US|38.97|-77.39
Austin|MN|US|43.67|-92.97
Sachse|TX|US|32.98|-96.6
Sun City West|AZ|US|33.66|-112.34
Watauga|TX|US|32.86|-97.25
Kingstown|Saint George Parish|VC|13.16|-61.23
Burlington|MA|US|42.5|-71.2
San Benito|TX|US|26.13|-97.63
Freeport|IL|US|42.3|-89.62
Forest Grove|OR|US|45.52|-123.11
Palmetto Bay|FL|US|25.62|-80.32
Staunton|VA|US|38.15|-79.07
Selma|CA|US|36.57|-119.61
South Windsor|CT|US|41.82|-72.62
North Potomac|MD|US|39.08|-77.26
Homer Glen|IL|US|41.6|-87.94
Coral Terrace|FL|US|25.75|-80.3
Norfolk|NE|US|42.03|-97.42
Ridgeland|MS|US|32.43|-90.13
Scaggsville|MD|US|39.15|-76.9
Cudahy|CA|US|33.96|-118.19
Washington|UT|US|37.13|-113.51
New Smyrna Beach|FL|US|29.03|-80.93
South Plainfield|NJ|US|40.58|-74.41
Pasadena|MD|US|39.12|-76.57
Columbine|CO|US|39.59|-105.07
Greenbelt|MD|US|39|-76.88
South Riding|VA|US|38.92|-77.5
Citrus Park|FL|US|28.08|-82.57
Boca Del Mar|FL|US|26.35|-80.15
Newport|RI|US|41.49|-71.31
Norton Shores|MI|US|43.17|-86.26
Barstow Heights|CA|US|34.87|-117.06
Rockville Centre|NY|US|40.66|-73.64
Searcy|AR|US|35.25|-91.74
North Platte|NE|US|41.12|-100.77
Rolling Meadows|IL|US|42.08|-88.01
Carteret|NJ|US|40.58|-74.23
Immokalee|FL|US|26.42|-81.42
Woodlawn|IL|US|41.78|-87.6
Medford|NY|US|40.82|-73
Lawndale|PA|US|40.05|-75.09
Riverbank|CA|US|37.74|-120.94
Zion|IL|US|42.45|-87.83
Trotwood|OH|US|39.8|-84.31
North Haven|CT|US|41.39|-72.86
Summerlin South|NV|US|36.12|-115.33
Mahwah|NJ|US|41.09|-74.14
Loma Linda|CA|US|34.05|-117.26
Peekskill|NY|US|41.29|-73.92
Keystone|FL|US|28.16|-82.62
Baldwin|NY|US|40.66|-73.61
Fairfax|VA|US|38.85|-77.31
Maywood|IL|US|41.88|-87.84
Sebastian|FL|US|27.82|-80.47
Holt|MI|US|42.64|-84.52
Muscatine|IA|US|41.42|-91.04
Elk River|MN|US|45.3|-93.57
Rock Springs|WY|US|41.59|-109.2
Golden Gate|FL|US|26.19|-81.7
Corsicana|TX|US|32.1|-96.47
Hialeah Gardens|FL|US|25.87|-80.32
Waverly|MI|US|42.74|-84.62
Hunt Valley|MD|US|39.5|-76.64
Fuquay-Varina|NC|US|35.58|-78.8
Fountain Hills|AZ|US|33.61|-111.72
Unionport|NY|US|40.83|-73.85
Champlin|MN|US|45.19|-93.4
South Portland Gardens|ME|US|43.64|-70.32
Centerville|OH|US|39.63|-84.16
Bloomington|CA|US|34.07|-117.4
Bainbridge Island|WA|US|47.63|-122.52
Morrisville|NC|US|35.82|-78.83
Marshall|TX|US|32.54|-94.37
Watertown|WI|US|43.19|-88.73
Kernersville|NC|US|36.12|-80.07
Dickinson|ND|US|46.88|-102.79
Old Bridge|NJ|US|40.41|-74.37
Fort Washington|MD|US|38.71|-77.02
Dinuba|CA|US|36.54|-119.39
Van Nest|NY|US|40.85|-73.86
Barstow|CA|US|34.9|-117.02
Fairland|MD|US|39.08|-76.96
Brookings|SD|US|44.31|-96.8
Blue Island|IL|US|41.66|-87.68
Faribault|MN|US|44.29|-93.27
Chestnut Hill|MA|US|42.33|-71.17
Baileys Crossroads|VA|US|38.85|-77.13
Eagle|ID|US|43.7|-116.35
Norland|FL|US|25.95|-80.21
Scotch Plains|NJ|US|40.66|-74.39
Glenville|OH|US|41.53|-81.62
El Cerrito|CA|US|37.92|-122.31
Brandon|MS|US|32.27|-89.99
Derby|KS|US|37.55|-97.27
Frankford|PA|US|40.01|-75.08
Graham|WA|US|47.05|-122.29
Ilchester|MD|US|39.23|-76.79
Bayonet Point|FL|US|28.33|-82.68
Easton|MA|US|42.02|-71.13
Loves Park|IL|US|42.32|-89.06
Avon Lake|OH|US|41.51|-82.03
San Lorenzo|CA|US|37.67|-122.13
Morton Grove|IL|US|42.04|-87.78
Kingston|NY|US|41.93|-74
McDonough|GA|US|33.45|-84.15
Romulus|MI|US|42.22|-83.4
Rosemount|MN|US|44.74|-93.13
Northwest One|DC|US|38.9|-77.01
Mansfield|MA|US|42.03|-71.22
Eloise|FL|US|27.99|-81.74
Laguna Beach|CA|US|33.54|-117.78
Springfield|PA|US|39.93|-75.32
Bellview|FL|US|30.46|-87.31
Manoa|HI|US|21.32|-157.8
Terrytown|LA|US|29.91|-90.03
Crestview|FL|US|30.76|-86.57
Keene|NH|US|42.93|-72.28
Greenwood|SC|US|34.2|-82.16
Gallup|NM|US|35.53|-108.74
South Old Bridge|NJ|US|40.41|-74.35
Duncan|OK|US|34.5|-97.96
Dupont Circle|DC|US|38.91|-77.04
Griffin|GA|US|33.25|-84.26
Dolton|IL|US|41.64|-87.61
Webster Groves|MO|US|38.59|-90.36
Belton|MO|US|38.81|-94.53
Columbus|MS|US|33.5|-88.43
Denison|TX|US|33.76|-96.54
East Elmhurst|NY|US|40.76|-73.87
Kerrville|TX|US|30.05|-99.14
Pooler|GA|US|32.12|-81.25
Mequon|WI|US|43.22|-88.03
Vicksburg|MS|US|32.35|-90.88
Wright|FL|US|30.46|-86.64
Morrisania|NY|US|40.83|-73.91
Pacific Palisades|CA|US|34.05|-118.53
Palm City|FL|US|27.17|-80.27
Middleborough|MA|US|41.89|-70.91
Arnold|MD|US|39.03|-76.5
Isla Vista|CA|US|34.41|-119.86
Vero Beach South|FL|US|27.62|-80.41
Van Buren|AR|US|35.44|-94.35
East Peoria|IL|US|40.67|-89.58
Landover|MD|US|38.93|-76.9
Windham|CT|US|41.7|-72.16
Jacksonville Beach|FL|US|30.29|-81.39
Calabasas|CA|US|34.16|-118.64
Solon|OH|US|41.39|-81.44
Chantilly|VA|US|38.89|-77.43
Candler-McAfee|GA|US|33.73|-84.27
Roselle|IL|US|41.98|-88.08
Copiague|NY|US|40.68|-73.4
Westpark|CA|US|33.69|-117.81
Munster|IN|US|41.56|-87.51
Ladera Ranch|CA|US|33.57|-117.64
Lisle|IL|US|41.8|-88.07
Picnic Point-North Lynnwood|WA|US|47.86|-122.29
East Naples|FL|US|26.14|-81.77
Crystal|MN|US|45.03|-93.36
Cloverleaf|TX|US|29.78|-95.17
Dixiana|AL|US|33.74|-86.65
Highland|IN|US|41.55|-87.45
Machesney Park|IL|US|42.35|-89.04
Morgan Park|IL|US|41.69|-87.67
Noe Valley|CA|US|37.75|-122.43
East Tremont|NY|US|40.85|-73.89
Pelham|AL|US|33.29|-86.81
Victoria|La Riviere Anglaise|SC|-4.62|55.46
Auburn|ME|US|44.1|-70.23
Tremont|NY|US|40.85|-73.91
Lincolnia|VA|US|38.82|-77.14
Valinda|CA|US|34.05|-117.94
Marysville|OH|US|40.24|-83.37
Haines City|FL|US|28.11|-81.62
Columbus|NE|US|41.43|-97.37
Bristol|RI|US|41.68|-71.27
Millbrae|CA|US|37.6|-122.39
Newberg|OR|US|45.3|-122.97
The Crossings|FL|US|25.67|-80.4
Valley Station|KY|US|38.11|-85.87
Lennox|CA|US|33.94|-118.35
East Lake-Orient Park|FL|US|27.98|-82.38
Farmington|MN|US|44.64|-93.14
Wilsonville|OR|US|45.3|-122.77
Hutto|TX|US|30.54|-97.55
Bloomingdale|FL|US|27.89|-82.24
West Odessa|TX|US|31.84|-102.5
Inglewood-Finn Hill|WA|US|47.72|-122.23
Oak Harbor|WA|US|48.29|-122.64
'Ewa Gentry|HI|US|21.34|-158.03
Oak Ridge|FL|US|28.47|-81.42
Rosemont|CA|US|38.55|-121.36
Auburn Hills|MI|US|42.69|-83.23
Pottstown|PA|US|40.25|-75.65
West Puente Valley|CA|US|34.05|-117.97
Maple Heights|OH|US|41.42|-81.57
Willoughby|OH|US|41.64|-81.41
Benbrook|TX|US|32.67|-97.46
Cranford|NJ|US|40.66|-74.3
Garden City|NY|US|40.73|-73.63
Farmington|UT|US|40.98|-111.89
Wasco|IL|US|41.94|-88.4
Hastings|MN|US|44.74|-92.85
Avon|OH|US|41.45|-82.04
Visitacion Valley|CA|US|37.72|-122.4
North Augusta|SC|US|33.5|-81.97
Guilford|CT|US|41.29|-72.68
Cottage Lake|WA|US|47.74|-122.08
Corcoran|CA|US|36.1|-119.56
Melrose|NY|US|40.82|-73.91
East Patchogue|NY|US|40.77|-73
West Springfield|VA|US|38.77|-77.22
Wahiawa-Whitmore|HI|US|21.51|-158.03
Hudson|OH|US|41.24|-81.44
Port Hueneme|CA|US|34.15|-119.2
Holiday|FL|US|28.19|-82.74
Near South Side|IL|US|41.86|-87.62
Nuku'alofa|Tongatapu|TO|-21.14|-175.2
Radcliff|KY|US|37.84|-85.95
Hopewell|VA|US|37.3|-77.29
New Castle|PA|US|41|-80.35
Grand Boulevard|IL|US|41.81|-87.62
South Elgin|IL|US|41.99|-88.29
Prichard|AL|US|30.74|-88.08
New Brighton|MN|US|45.07|-93.2
Anniston|AL|US|33.66|-85.83
Palm Springs|FL|US|26.64|-80.1
Ruston|LA|US|32.52|-92.64
Wilmington|MA|US|42.55|-71.17
Midlothian|TX|US|32.48|-96.99
Oxford|MS|US|34.37|-89.52
Oakdale|CA|US|37.77|-120.85
Darien|IL|US|41.75|-87.97
Bloomingdale|IL|US|41.96|-88.08
Northwood|CA|US|33.71|-117.76
Venice|FL|US|27.1|-82.45
Ludlow|MA|US|42.16|-72.48
South Bradenton|FL|US|27.46|-82.58
Hillside|NJ|US|40.7|-74.23
Foggy Bottom|DC|US|38.9|-77.05
North Plainfield|NJ|US|40.63|-74.43
Acworth|GA|US|34.07|-84.68
Pascagoula|MS|US|30.37|-88.56
Sunny Isles Beach|FL|US|25.95|-80.12
Roseburg|OR|US|43.22|-123.34
Oxford|OH|US|39.51|-84.75
Merrick|NY|US|40.66|-73.55
Somerset|NJ|US|40.5|-74.49
Moses Lake|WA|US|47.13|-119.28
Saginaw|TX|US|32.86|-97.36
Greater Northdale|FL|US|28.11|-82.53
Northdale|FL|US|28.09|-82.51
Summit|NJ|US|40.72|-74.36
Watertown|SD|US|44.9|-97.12
Alliance|OH|US|40.92|-81.11
Kalispell|MT|US|48.2|-114.31
South Holland|IL|US|41.6|-87.61
Kenmore|WA|US|47.76|-122.24
Del City|OK|US|35.44|-97.44
Derry|NH|US|42.88|-71.33
Hamtramck|MI|US|42.39|-83.05
Great Kills|NY|US|40.55|-74.15
Wekiwa Springs|FL|US|28.7|-81.43
Leesburg|FL|US|28.81|-81.88
Duarte|CA|US|34.14|-117.98
Converse|TX|US|29.52|-98.32
Villa Park|IL|US|41.89|-87.99
Decatur|GA|US|33.77|-84.3
Park Forest|IL|US|41.49|-87.67
Christiansburg|VA|US|37.13|-80.41
Jurupa Valley|CA|US|33.99|-117.52
Logan|PA|US|40.03|-75.15
Ashland|CA|US|37.69|-122.11
West and East Lealman|FL|US|27.82|-82.69
Farragut|TN|US|35.88|-84.15
La Porte|IN|US|41.61|-86.71
Mount Vernon Triangle|DC|US|38.9|-77.02
Prairie Village|KS|US|38.99|-94.63
Smithfield|RI|US|41.92|-71.55
Clarksville|IN|US|38.3|-85.76
Wadsworth|OH|US|41.03|-81.73
Camas|WA|US|45.59|-122.4
Fort Walton Beach|FL|US|30.42|-86.62
Geneva|IL|US|41.89|-88.31
Brent|FL|US|30.47|-87.24
South Euclid|OH|US|41.52|-81.52
Brushy Creek|TX|US|30.51|-97.74
Westchase|FL|US|28.06|-82.61
Sugar Hill|GA|US|34.11|-84.03
Chillicothe|OH|US|39.33|-82.98
South Lake Tahoe|CA|US|38.93|-119.98
Anthem|AZ|US|33.86|-112.11
West Carson|CA|US|33.82|-118.29
Massapequa|NY|US|40.68|-73.47
Canton|MA|US|42.16|-71.14
Roselle|NJ|US|40.65|-74.26
Lincoln|RI|US|41.92|-71.44
Lumberton|NC|US|34.62|-79.01
Taylors|SC|US|34.92|-82.3
Yucca Valley|CA|US|34.11|-116.43
Westford|MA|US|42.58|-71.44
Rittenhouse|PA|US|39.95|-75.17
Edgewater|FL|US|28.99|-80.9
Allison Park|PA|US|40.56|-79.96
Bloomfield|CT|US|41.83|-72.73
Bay Point|CA|US|38.03|-121.96
Portsmouth|NH|US|43.08|-70.76
Sedalia|MO|US|38.7|-93.23
Naples|FL|US|26.14|-81.8
Patterson|CA|US|37.47|-121.13
Greenfield|IN|US|39.79|-85.77
Waynesboro|VA|US|38.07|-78.89
H Street NE|DC|US|38.9|-77
Albertville|AL|US|34.27|-86.21
Wissinoming|PA|US|40.02|-75.06
Stoneham|MA|US|42.48|-71.1
Tustin Legacy|CA|US|33.7|-117.83
Basking Ridge|NJ|US|40.71|-74.55
Perrysburg|OH|US|41.56|-83.63
Erie|CO|US|40.05|-105.05
Klamath Falls|OR|US|42.22|-121.78
Clinton|UT|US|41.14|-112.05
Green Valley|AZ|US|31.85|-110.99
Evans|CO|US|40.38|-104.69
Mandan|ND|US|46.83|-100.89
Winchester|MA|US|42.45|-71.14
Okemos|MI|US|42.72|-84.43
Arnold|MO|US|38.43|-90.38
East Moline|IL|US|41.5|-90.44
West Pensacola|FL|US|30.43|-87.28
Kinston|NC|US|35.26|-77.58
Shelbyville|TN|US|35.48|-86.46
Marquette|MI|US|46.54|-87.4
Fairfield Heights|IN|US|39.83|-86.38
Biddeford|ME|US|43.49|-70.45
Golden Valley|MN|US|45.01|-93.35
Canyon Lake|TX|US|29.88|-98.26
Conda|ID|US|42.73|-111.53
Oxford|AL|US|33.61|-85.83
South Milwaukee|WI|US|42.91|-87.86
Marina|CA|US|36.68|-121.8
Mukilteo|WA|US|47.94|-122.3
Rancho San Diego|CA|US|32.75|-116.94
Charleston|IL|US|39.5|-88.18
Bedford|NH|US|42.95|-71.52
Pleasant Plains|DC|US|38.93|-77.02
Carrboro|NC|US|35.91|-79.08
Crest Hill|IL|US|41.55|-88.1
Saint Andrews|SC|US|34.04|-81.1
Ashland|KY|US|38.48|-82.64
Hays|KS|US|38.88|-99.33
'Ewa Beach-Iroquois Point|HI|US|21.32|-157.99
Mililani Mauka|HI|US|21.48|-157.99
Ferguson|MO|US|38.74|-90.31
Conway|SC|US|33.84|-79.05
Laurelton|NY|US|40.67|-73.75
Lino Lakes|MN|US|45.16|-93.09
West Lake Stevens|WA|US|47.99|-122.1
New Hope|MN|US|45.04|-93.39
Palm River-Clair Mel|FL|US|27.92|-82.38
Trussville|AL|US|33.62|-86.61
Woodrow|NY|US|40.54|-74.19
Corinth|TX|US|33.15|-97.06
Mountlake Terrace|WA|US|47.79|-122.31
Chester|VA|US|37.36|-77.44
Nixa|MO|US|37.04|-93.29
East Ridge|TN|US|35.01|-85.25
Makakilo-Makaiwa Hills-Kunia|HI|US|21.37|-158.07
Plainview|TX|US|34.18|-101.71
Grayslake|IL|US|42.34|-88.04
Agoura Hills|CA|US|34.14|-118.77
Acton|MA|US|42.49|-71.43
Sanford|ME|US|43.44|-70.77
Silver Firs|WA|US|47.87|-122.16
Hauppauge|NY|US|40.83|-73.2
Kihei|HI|US|20.76|-156.45
South El Monte|CA|US|34.05|-118.05
Kaimuki|HI|US|21.28|-157.8
Arvin|CA|US|35.21|-118.83
Johnston|IA|US|41.67|-93.7
Gardner|KS|US|38.81|-94.93
Lathrop|CA|US|37.82|-121.28
Ashland|OR|US|42.19|-122.71
Sidney|OH|US|40.28|-84.16
Birmingham|MI|US|42.55|-83.21
Sweetwater|FL|US|25.76|-80.37
Milwaukie|OR|US|45.45|-122.64
East Millcreek|UT|US|40.7|-111.81
Grand Island|NY|US|43.03|-78.96
Union City|GA|US|33.59|-84.54
Woodlawn|VA|US|38.72|-77.13
Piqua|OH|US|40.14|-84.24
Lomita|CA|US|33.79|-118.32
Cockeysville|MD|US|39.48|-76.64
Easley|SC|US|34.83|-82.6
New Springville|NY|US|40.59|-74.16
Pleasantville|NJ|US|39.39|-74.52
Liberal|KS|US|37.04|-100.92
Palisades Park|NJ|US|40.85|-74
Jenks|OK|US|36.02|-95.97
Simpsonville|SC|US|34.74|-82.25
Latham|NY|US|42.75|-73.76
Darien|CT|US|41.08|-73.47
Pleasant Prairie|WI|US|42.55|-87.93
NoMa|DC|US|38.9|-77.01
Mountain Brook|AL|US|33.5|-86.75
Chambersburg|PA|US|39.94|-77.66
Adrian|MI|US|41.9|-84.04
West Melbourne|FL|US|28.07|-80.65
East Garfield Park|IL|US|41.88|-87.7
Rotterdam|NY|US|42.79|-73.97
Lakeside|CA|US|32.86|-116.92
Kalihi Valley|HI|US|21.36|-157.84
Bethany|OR|US|45.56|-122.87
Lake Worth Corridor|FL|US|26.62|-80.1
Winter Gardens|CA|US|32.83|-116.93
Lockport|NY|US|43.17|-78.69
Lebanon|OH|US|39.44|-84.2
Wade Hampton|SC|US|34.9|-82.33
Murphy|TX|US|33.02|-96.61
Coralville|IA|US|41.68|-91.58
Ensley|FL|US|30.52|-87.27
Sapulpa|OK|US|36|-96.11
American Canyon|CA|US|38.17|-122.26
South San Jose Hills|CA|US|34.01|-117.9
Belton|TX|US|31.06|-97.46
Agoura|CA|US|34.14|-118.74
Bayville|NJ|US|39.91|-74.15
Arbutus|MD|US|39.25|-76.7
Hammond|LA|US|30.5|-90.46
Schofield-Wheeler|HI|US|21.48|-158.05
Libertyville|IL|US|42.28|-87.95
Andorra la Vella|Andorra la Vella|AD|42.51|1.52
Pittsburg|KS|US|37.41|-94.7
Portsmouth|OH|US|38.73|-83
Granite Bay|CA|US|38.76|-121.16
Charlestown|MA|US|42.38|-71.06
Louisville|CO|US|39.98|-105.13
Northfield|MN|US|44.46|-93.16
Rocky River|OH|US|41.48|-81.84
Raymore|MO|US|38.8|-94.45
Middletown|DE|US|39.45|-75.72
Havelock|NC|US|34.88|-76.9
Harvey|LA|US|29.9|-90.08
Gardner|MA|US|42.58|-72
Golden|CO|US|39.76|-105.22
Douglas|IL|US|41.83|-87.62
Cartersville|GA|US|34.17|-84.8
Ashland|OH|US|40.87|-82.32
Oakleaf Plantation|FL|US|30.17|-81.84
Affton|MO|US|38.55|-90.33
Ramona|CA|US|33.04|-116.87
Cambria Heights|NY|US|40.69|-73.74
Elmwood Park|NJ|US|40.9|-74.12
Elko|NV|US|40.83|-115.76
Hollis|NY|US|40.71|-73.77
Brooklyn Heights|NY|US|40.7|-73.99
Nogales|AZ|US|31.34|-110.93
Parma Heights|OH|US|41.39|-81.76
La Canada Flintridge|CA|US|34.2|-118.19
Mustang|OK|US|35.38|-97.72
Rose Hill|VA|US|38.79|-77.11
East Northport|NY|US|40.88|-73.32
Glen Avon|CA|US|34.01|-117.48
Sulphur|LA|US|30.24|-93.38
Shelby|NC|US|35.29|-81.54
Montville Center|CT|US|41.48|-72.15
Ferndale|MI|US|42.46|-83.13
South Saint Paul|MN|US|44.89|-93.03
Lynn Haven|FL|US|30.25|-85.65
Lents|OR|US|45.48|-122.57
Lake Ronkonkoma|NY|US|40.84|-73.13
Millburn|NJ|US|40.72|-74.3
Lexington|SC|US|33.98|-81.24
Murrysville|PA|US|40.43|-79.7
Cumberland|MD|US|39.65|-78.76
Stephenville|TX|US|32.22|-98.2
Oregon|OH|US|41.64|-83.49
Eastmont|WA|US|47.9|-122.18
Monroe|MI|US|41.92|-83.4
Coconut Grove|FL|US|25.71|-80.26
West Mifflin|PA|US|40.36|-79.87
Haddington|PA|US|39.97|-75.24
Mill Creek|WA|US|47.86|-122.2
Pace|FL|US|30.6|-87.16
Miamisburg|OH|US|39.64|-84.29
Palm Valley|FL|US|30.18|-81.39
Rolla|MO|US|37.95|-91.77
Tukwila|WA|US|47.47|-122.26
Castries|Castries|LC|14|-61.01
New Caney|TX|US|30.16|-95.21
Charlotte Amalie|Saint Thomas Island|VI|18.34|-64.93
DeBary|FL|US|28.88|-81.31
Lyndhurst|NJ|US|40.81|-74.12
Lake Zurich|IL|US|42.2|-88.09
Germantown|WI|US|43.23|-88.11
Bryant|AR|US|34.6|-92.49
Eustis|FL|US|28.85|-81.69
Universal City|TX|US|29.55|-98.29
Newburg|KY|US|38.16|-85.66
Johnstown|PA|US|40.33|-78.92
Socastee|SC|US|33.68|-79
Ypsilanti|MI|US|42.24|-83.61
North Bellmore|NY|US|40.69|-73.53
King of Prussia|PA|US|40.09|-75.4
Hayesville|OR|US|44.99|-122.98
Cortlandt Manor|NY|US|41.28|-73.87
Warrensburg|MO|US|38.76|-93.74
Mokena|IL|US|41.53|-87.89
Norwood|OH|US|39.16|-84.46
Mariners Harbor|NY|US|40.64|-74.16
Bonney Lake|WA|US|47.18|-122.19
Dickinson|TX|US|29.46|-95.05
Clifton|CO|US|39.09|-108.45
Lealman|FL|US|27.82|-82.68
Waikiki|HI|US|21.29|-157.84
Hermosa Beach|CA|US|33.86|-118.4
Selden|NY|US|40.87|-73.04
Clemmons|NC|US|36.02|-80.38
West Chester|PA|US|39.96|-75.61
Evergreen Park|IL|US|41.72|-87.7
Southbury|CT|US|41.48|-73.21
Baldwin|PA|US|40.34|-79.98
Marblehead|MA|US|42.5|-70.86
Norton|MA|US|41.97|-71.19
Plattsburgh|NY|US|44.7|-73.45
North Salt Lake|UT|US|40.85|-111.91
Sand Springs|OK|US|36.14|-96.11
Painesville|OH|US|41.72|-81.25
Diamond Head / Kapahulu / Saint Louis Heights|HI|US|21.28|-157.81
Greenfield|MA|US|42.59|-72.6
Hartranft|PA|US|39.98|-75.15
Pickerington|OH|US|39.88|-82.75
New Canaan|CT|US|41.15|-73.49
Albany|CA|US|37.89|-122.3
Snellville|GA|US|33.86|-84.02
Fox Chase|PA|US|40.08|-75.08
Sparta|NJ|US|41.03|-74.64
Columbia Heights|MN|US|45.04|-93.26
Holtsville|NY|US|40.82|-73.05
Salmon Creek|WA|US|45.71|-122.65
Kingsessing|PA|US|39.94|-75.23
La Crescenta-Montrose|CA|US|34.23|-118.24
Spanish Lake|MO|US|38.79|-90.22
Willmar|MN|US|45.12|-95.04
Tysons|VA|US|38.92|-77.23
Forest Lake|MN|US|45.28|-92.99
Bethany|OK|US|35.52|-97.63
Sun City|CA|US|33.71|-117.2
Montclair|VA|US|38.61|-77.34
Lynbrook|NY|US|40.65|-73.67
Orchards|WA|US|45.67|-122.56
Eastchester|NY|US|40.96|-73.81
Payson|UT|US|40.04|-111.73
West Saint Paul|MN|US|44.92|-93.1
Madisonville|KY|US|37.33|-87.5
Ives Estates|FL|US|25.96|-80.18
Selma|AL|US|32.41|-87.02
Papillion|NE|US|41.15|-96.04
Montgomery|IL|US|41.73|-88.35
Badger|AK|US|64.8|-147.53
Seymour|IN|US|38.96|-85.89
Lake Shore|MD|US|39.11|-76.48
McKeesport|PA|US|40.35|-79.86
Pinecrest|FL|US|25.67|-80.31
Weirton Heights|WV|US|40.41|-80.54
Port Angeles|WA|US|48.12|-123.43
Hazel Dell|WA|US|45.67|-122.66
Angleton|TX|US|29.17|-95.43
Fernley|NV|US|39.61|-119.25
Alice|TX|US|27.75|-98.07
Lake Forest|IL|US|42.26|-87.84
Battle Ground|WA|US|45.78|-122.53
Dixon|CA|US|38.45|-121.82
Forest Park|GA|US|33.62|-84.37
Mamaroneck|NY|US|40.95|-73.73
Homewood|IL|US|41.56|-87.67
Bear|DE|US|39.63|-75.66
Bayou Cane|LA|US|29.62|-90.75
Orange|TX|US|30.09|-93.74
Alsip|IL|US|41.67|-87.74
Lutz|FL|US|28.15|-82.46
Green Haven|MD|US|39.14|-76.55
Lexington|NC|US|35.82|-80.25
Bellwood|IL|US|41.88|-87.88
Clayton|NC|US|35.65|-78.46
Central Falls|RI|US|41.89|-71.39
Sun Valley|NV|US|39.6|-119.78
Horizon City|TX|US|31.69|-106.21
Sherwood|OR|US|45.36|-122.84
Waterford|CT|US|41.34|-72.14
Orinda|CA|US|37.88|-122.18
Pinole|CA|US|38|-122.3
Woodbridge|NJ|US|40.56|-74.28
Sun City Center|FL|US|27.72|-82.35
Rosedale|MD|US|39.32|-76.52
Altamont|OR|US|42.21|-121.74
Howard|WI|US|44.54|-88.09
Niu Valley|HI|US|21.28|-157.74
Alamo|TX|US|26.18|-98.12
Broadview Heights|OH|US|41.31|-81.69
Upper Saint Clair|PA|US|40.34|-80.08
Haslett|MI|US|42.75|-84.4
West Elsdon|IL|US|41.79|-87.72
Newton|KS|US|38.05|-97.35
Glassboro|NJ|US|39.7|-75.11
Altus|OK|US|34.64|-99.33
Blythe|CA|US|33.61|-114.6
Silverdale|WA|US|47.64|-122.69
Covington|WA|US|47.36|-122.12
Matteson|IL|US|41.5|-87.71
Tumwater|WA|US|47.01|-122.91
Old Jamestown|MO|US|38.83|-90.29
Weirton|WV|US|40.42|-80.59
White Oak|OH|US|39.21|-84.6
Carlisle|PA|US|40.2|-77.19
Mineola|NY|US|40.75|-73.64
Shelbyville|IN|US|39.52|-85.78
Tullahoma|TN|US|35.36|-86.21
Ozark|MO|US|37.02|-93.21
Secaucus|NJ|US|40.79|-74.06
Jacksonville|IL|US|39.73|-90.23
Fairwood|WA|US|47.45|-122.16
Madison|CT|US|41.28|-72.6
Camp Springs|MD|US|38.8|-76.91
Ronkonkoma|NY|US|40.82|-73.14
Saco|ME|US|43.5|-70.44
Maple Shade|NJ|US|39.95|-74.99
Hawthorne|NJ|US|40.95|-74.15
Fresno|TX|US|29.54|-95.45
East Massapequa|NY|US|40.67|-73.44
Amherst Center|MA|US|42.38|-72.52
Montrose|CO|US|38.48|-107.88
Marion Oaks|FL|US|29.01|-82.18
Brownwood|TX|US|31.71|-98.99
Southbridge|MA|US|42.08|-72.03
Deerfield|IL|US|42.17|-87.84
Castaic|CA|US|34.49|-118.62
Ennis|TX|US|32.33|-96.63
Ellensburg|WA|US|47|-120.55
Columbia City|WA|US|47.56|-122.28
Claremore|OK|US|36.31|-95.62
Waukee|IA|US|41.61|-93.89
Jasmine Estates|FL|US|28.29|-82.69
Melville|NY|US|40.79|-73.42
Petworth|DC|US|38.95|-77.02
Kew Gardens|NY|US|40.71|-73.83
Middleton|WI|US|43.1|-89.5
Bartow|FL|US|27.9|-81.84
Sylvania|OH|US|41.72|-83.71
Rio Rico|AZ|US|31.47|-110.98
Ala Moana - Kaka'ako|HI|US|21.3|-157.86
Murray|KY|US|36.61|-88.31
Arlington|WA|US|48.2|-122.13
North Druid Hills|GA|US|33.82|-84.31
Brookfield|IL|US|41.82|-87.85
North Bay Shore|NY|US|40.75|-73.26
Stonegate|CA|US|33.71|-117.74
Avon|CT|US|41.81|-72.83
Milledgeville|GA|US|33.08|-83.23
Stillwater|MN|US|45.06|-92.81
Cortland|NY|US|42.6|-76.18
Augusta|ME|US|44.31|-69.78
Berea|OH|US|41.37|-81.85
Capitol Riverfront|DC|US|38.88|-77
Twinsburg|OH|US|41.31|-81.44
Wantagh|NY|US|40.68|-73.51
West Hempstead|NY|US|40.7|-73.65
Ansonia|CT|US|41.35|-73.08
Troy|AL|US|31.81|-85.97
Mayfield Heights|OH|US|41.52|-81.46
Laurel|MS|US|31.69|-89.13
Syosset|NY|US|40.83|-73.5
Brook Park|OH|US|41.4|-81.8
Union Hill-Novelty Hill|WA|US|47.68|-122.03
Erlanger|KY|US|39.02|-84.6
Park View|DC|US|38.93|-77.02
Rossville|NY|US|40.55|-74.21
South Burlington|VT|US|44.47|-73.17
Mount Greenwood|IL|US|41.7|-87.71
Casa de Oro-Mount Helix|CA|US|32.76|-116.97
Langley Park|MD|US|38.99|-76.98
Brigham City|UT|US|41.51|-112.02
Thomasville|GA|US|30.84|-83.98
Fairmont|WV|US|39.49|-80.14
Fairhope|AL|US|30.52|-87.9
Mission Hill|MA|US|42.33|-71.11
Greater Upper Marlboro|MD|US|38.83|-76.75
Frederickson|WA|US|47.1|-122.36
Iselin|NJ|US|40.58|-74.32
Suwanee|GA|US|34.05|-84.07
Whitehall|OH|US|39.97|-82.89
Rutherford|NJ|US|40.83|-74.11
Islip|NY|US|40.73|-73.21
Forest Park|OH|US|39.29|-84.5
Westminster|MD|US|39.58|-77
Frankfort|IL|US|41.5|-87.85
Niles|OH|US|41.18|-80.77
Marshfield|WI|US|44.67|-90.17
Lorton|VA|US|38.7|-77.23
Morristown|NJ|US|40.8|-74.48
Gautier|MS|US|30.39|-88.61
Bourbonnais|IL|US|41.15|-87.89
Goodings Grove|IL|US|41.63|-87.93
Macomb|IL|US|40.46|-90.67
Point Pleasant|NJ|US|40.08|-74.07
Bellaire|TX|US|29.71|-95.46
El Reno|OK|US|35.53|-97.96
East Mount Airy|PA|US|40.06|-75.19
Chowchilla|CA|US|37.12|-120.26
Mead Valley|CA|US|33.83|-117.3
Hyattsville|MD|US|38.96|-76.95
Happy Valley|OR|US|45.45|-122.53
Onalaska|WI|US|43.88|-91.24
Round Lake|IL|US|42.35|-88.09
Stafford|TX|US|29.62|-95.56
Yorkville|IL|US|41.64|-88.45
Winchester|KY|US|37.99|-84.18
North Ogden|UT|US|41.31|-111.96
Bensenville|IL|US|41.96|-87.94
Forney|TX|US|32.75|-96.47
Monsey|NY|US|41.11|-74.07
Fern Creek|KY|US|38.16|-85.59
Shenandoah|LA|US|30.4|-91
El Dorado|AR|US|33.21|-92.67
Trenton|MI|US|42.14|-83.18
Ashtabula|OH|US|41.87|-80.79
Natchitoches|LA|US|31.76|-93.09
Cudahy|WI|US|42.96|-87.86
Dover|NJ|US|40.88|-74.56
Ottawa|IL|US|41.35|-88.84
Shafter|CA|US|35.5|-119.27
Midlothian|VA|US|37.51|-77.65
Amesbury|MA|US|42.86|-70.93
Franklin Park|IL|US|41.94|-87.87
Meadowbrook|VA|US|37.45|-77.47
McAlester|OK|US|34.93|-95.77
Punta Gorda Isles|FL|US|26.92|-82.08
Palestine|TX|US|31.76|-95.63
Sherrelwood|CO|US|39.84|-105
Creve Coeur|MO|US|38.66|-90.42
Ballenger Creek|MD|US|39.37|-77.44
Cinco Ranch|TX|US|29.74|-95.76
Helena|AL|US|33.3|-86.84
Palmer|MA|US|42.16|-72.33
Belle Glade|FL|US|26.68|-80.67
Makakilo|HI|US|21.35|-158.09
Franconia|VA|US|38.78|-77.15
Eastlake|OH|US|41.65|-81.45
Manchester|MO|US|38.6|-90.51
Cameron Park|CA|US|38.67|-120.99
Steubenville|OH|US|40.37|-80.63
Springboro|OH|US|39.55|-84.23
Wallingford Center|CT|US|41.45|-72.82
Lanham-Seabrook|MD|US|38.97|-76.85
Clark-Fulton|OH|US|41.46|-81.71
Farmington|MO|US|37.78|-90.42
Pampa|TX|US|35.54|-100.96
Somerset|MA|US|41.77|-71.13
Florida Ridge|FL|US|27.58|-80.39
Five Corners|WA|US|45.68|-122.58
Boone|NC|US|36.22|-81.67
Seminole|FL|US|27.84|-82.79
Punta Gorda|FL|US|26.93|-82.05
Rosamond|CA|US|34.86|-118.16
Cutler|FL|US|25.62|-80.31
Mattoon|IL|US|39.48|-88.37
Arroyo Grande|CA|US|35.12|-120.59
Anacortes|WA|US|48.51|-122.61
Monroe|WA|US|47.86|-121.97
Rancho Mirage|CA|US|33.74|-116.41
Limerick|PA|US|40.23|-75.52
Mililani Mauka / Launani Valley|HI|US|21.48|-157.99
Wilton|CT|US|41.2|-73.44
Huntington|NY|US|40.87|-73.43
Ojus|FL|US|25.95|-80.15
Santa Fe Springs|CA|US|33.95|-118.09
Vincennes|IN|US|38.68|-87.53
Amsterdam|NY|US|42.94|-74.19
Durango|CO|US|37.28|-107.88
Dumont|NJ|US|40.94|-74
Hanahan|SC|US|32.92|-80.02
Central Point|OR|US|42.38|-122.92
Highland|UT|US|40.43|-111.79
Elizabeth City|NC|US|36.29|-76.25
Newburyport|MA|US|42.81|-70.88
Rockland|MA|US|42.13|-70.92
Westbrook|ME|US|43.68|-70.37
St. Marys|GA|US|30.73|-81.55
Cary|IL|US|42.21|-88.24
Lackawanna|NY|US|42.83|-78.82
Westerly|RI|US|41.38|-71.83
Maumelle|AR|US|34.87|-92.4
Leland|NC|US|34.26|-78.04
Wisconsin Rapids|WI|US|44.38|-89.82
Lenoir|NC|US|35.91|-81.54
North Massapequa|NY|US|40.7|-73.46
Scarsdale|NY|US|41.01|-73.78
Nanuet|NY|US|41.09|-74.01
Gretna|LA|US|29.91|-90.05
Sheridan|WY|US|44.8|-106.96
North Amityville|NY|US|40.7|-73.43
Tacony|PA|US|40.03|-75.04
Arcata|CA|US|40.87|-124.08
Hannibal|MO|US|39.71|-91.36
Wahiawa|HI|US|21.5|-158.02
Colonial Heights|VA|US|37.27|-77.41
Marion|IL|US|37.73|-88.93
Colonia|NJ|US|40.57|-74.3
Logansport|IN|US|40.75|-86.36
Oswego|NY|US|43.46|-76.51
Linda|CA|US|39.13|-121.55
Tinton Falls|NJ|US|40.3|-74.1
Godfrey|IL|US|38.96|-90.19
Portsmouth|RI|US|41.6|-71.25
Times Square|NY|US|40.76|-73.99
West Garfield Park|IL|US|41.88|-87.73
Willimantic|CT|US|41.71|-72.21
Calverton|MD|US|39.06|-76.94
Oxon Hill|MD|US|38.8|-76.99
Takoma Park|MD|US|38.98|-77.01
Wallingford|CT|US|41.46|-72.82
Sycamore|IL|US|41.99|-88.69
Cocoa|FL|US|28.39|-80.74
Martinsburg|WV|US|39.46|-77.96
Marco Island|FL|US|25.94|-81.72
Tiffin|OH|US|41.11|-83.18
Hunting Park|PA|US|40.02|-75.14
Albert Lea|MN|US|43.65|-93.37
Golden Triangle|DC|US|38.91|-77.04
South Hadley|MA|US|42.26|-72.57
Juniata Park|PA|US|40.01|-75.11
Shaw|DC|US|38.91|-77.02
Ocean Springs|MS|US|30.41|-88.83
Hinsdale|IL|US|41.8|-87.94
Brightwood|DC|US|38.96|-77.03
New Castle|IN|US|39.93|-85.37
Winthrop|MA|US|42.38|-70.98
Lindenwold|NJ|US|39.82|-75
Kenwood|IL|US|41.81|-87.6
Bay City|TX|US|28.98|-95.97
Hopkins|MN|US|44.92|-93.46
Allendale|MI|US|42.97|-85.95
University City|PA|US|39.95|-75.19
Back Bay|MA|US|42.35|-71.09
Menasha|WI|US|44.2|-88.45
Palos Hills|IL|US|41.7|-87.82
Prunedale|CA|US|36.78|-121.67
Culpeper|VA|US|38.47|-78
Stevenson Ranch|CA|US|34.39|-118.57
South Houston|TX|US|29.66|-95.24
Kirksville|MO|US|40.19|-92.58
Tallmadge|OH|US|41.1|-81.44
North Babylon|NY|US|40.72|-73.32
Mesquite|NV|US|36.81|-114.07
New Philadelphia|OH|US|40.49|-81.45
Saint Matthews|KY|US|38.25|-85.66
Maitland|FL|US|28.63|-81.36
North Aurora|IL|US|41.81|-88.33
Safety Harbor|FL|US|27.99|-82.69
North Canton|OH|US|40.88|-81.4
East Hemet|CA|US|33.74|-116.94
White Oak|MD|US|39.04|-76.99
Radford|VA|US|37.13|-80.58
Tillmans Corner|AL|US|30.59|-88.17
Nicetown-Tioga|PA|US|40.01|-75.16
Detroit-Shoreway|OH|US|41.48|-81.73
Wilton|NY|US|43.18|-73.74
Anoka|MN|US|45.2|-93.39
East Cleveland|OH|US|41.53|-81.58
Sudbury|MA|US|42.38|-71.42
Plainville|CT|US|41.67|-72.86
Ada|OK|US|34.77|-96.68
Middletown|RI|US|41.55|-71.29
Glassmanor|MD|US|38.82|-77
South Orange|NJ|US|40.75|-74.26
Idylwood|VA|US|38.9|-77.21
Seabrook|MD|US|38.97|-76.85
Durant|OK|US|33.99|-96.37
Killingly Center|CT|US|41.84|-71.87
Kings Park|NY|US|40.89|-73.26
Canby|OR|US|45.26|-122.69
Poplar Bluff|MO|US|36.76|-90.39
Moraga|CA|US|37.83|-122.13
Redland|MD|US|39.15|-77.14
Massapequa Park|NY|US|40.68|-73.46
Kuna|ID|US|43.49|-116.42
Foley|AL|US|30.41|-87.68
Ruskin|FL|US|27.72|-82.43
Hermiston|OR|US|45.84|-119.29
Nederland|TX|US|29.97|-93.99
Greenfield|CA|US|36.32|-121.24
Ashwaubenon|WI|US|44.48|-88.07
Live Oak|CA|US|36.98|-121.98
Bristol|VA|US|36.6|-82.19
Frankford|MD|US|39.33|-76.54
Okolona|KY|US|38.14|-85.69
Bayside|CA|US|40.84|-124.06
Wyckoff|NJ|US|41.01|-74.17
Woodmere|NY|US|40.63|-73.71
Huntington|IN|US|40.88|-85.5
Imperial|CA|US|32.85|-115.57
Wayne|MI|US|42.28|-83.39
White Settlement|TX|US|32.76|-97.46
Eloy|AZ|US|32.76|-111.55
Beckley|WV|US|37.78|-81.19
Broad Ripple|IN|US|39.87|-86.14
El Segundo|CA|US|33.92|-118.42
Holden|MA|US|42.35|-71.86
Avenel|NJ|US|40.58|-74.29
East Setauket|NY|US|40.94|-73.11
Goodlettsville|TN|US|36.32|-86.71
Fayetteville|GA|US|33.45|-84.45
Elmwood|PA|US|39.92|-75.23
Colchester|VT|US|44.54|-73.15
Altoona|IA|US|41.64|-93.46
Terrell|TX|US|32.74|-96.28
Point Breeze|PA|US|39.93|-75.18
Artesia|CA|US|33.87|-118.08
South Ogden|UT|US|41.19|-111.97
La Vista|NE|US|41.18|-96.03
Hanover|MA|US|42.11|-70.81
Tanque Verde|AZ|US|32.25|-110.74
Glenvar Heights|FL|US|25.71|-80.33
Pendleton|OR|US|45.67|-118.79
Centerville|UT|US|40.92|-111.87
Parkside|CA|US|37.74|-122.49
Sayville|NY|US|40.74|-73.08
Clarksdale|MS|US|34.2|-90.57
Fairview Heights|IL|US|38.59|-89.99
Norwalk|OH|US|41.24|-82.62
San Carlos Park|FL|US|26.47|-81.8
Concord|MA|US|42.46|-71.35
Springfield|TN|US|36.51|-86.89
New Milford|NJ|US|40.94|-74.02
North Attleborough Center|MA|US|41.97|-71.32
Country Club Hills|IL|US|41.57|-87.72
Lemont|IL|US|41.67|-88
Sartell|MN|US|45.62|-94.21
Parkwood Manor|PA|US|40.09|-74.97
Dyersburg|TN|US|36.03|-89.39
Defiance|OH|US|41.28|-84.36
Beltsville|MD|US|39.03|-76.91
Centralia|WA|US|46.72|-122.95
Chalmette|LA|US|29.94|-89.97
Shorewood|IL|US|41.52|-88.2
Ferndale|MD|US|39.18|-76.64
Mount Vernon|OH|US|40.39|-82.49
Westchester|IL|US|41.85|-87.88
Bluffton|SC|US|32.24|-80.86
Tifton|GA|US|31.45|-83.51
Auburn|MA|US|42.19|-71.84
Nipomo|CA|US|35.04|-120.48
Laurel|VA|US|37.64|-77.51
Taylor|TX|US|30.57|-97.41
North Decatur|GA|US|33.79|-84.31
Morganton|NC|US|35.75|-81.68
Danville|KY|US|37.65|-84.77
Denville|NJ|US|40.89|-74.48
Barrington|RI|US|41.74|-71.31
Washington|IL|US|40.7|-89.41
Phoenixville|PA|US|40.13|-75.51
Mercedes|TX|US|26.15|-97.91
Center Point|AL|US|33.65|-86.68
Lemay|MO|US|38.53|-90.28
Wolcott|CT|US|41.6|-72.99
Norcross|GA|US|33.94|-84.21
Troutdale|OR|US|45.54|-122.39
Oak Grove|OR|US|45.42|-122.64
North Valley Stream|NY|US|40.69|-73.7
Easton|MD|US|38.77|-76.08
Easthampton|MA|US|42.27|-72.67
Bothell West|WA|US|47.81|-122.24
Tahlequah|OK|US|35.92|-94.97
Hazel Park|MI|US|42.46|-83.1
Douglas|AZ|US|31.34|-109.55
Opelousas|LA|US|30.53|-92.08
Grafton|MA|US|42.21|-71.69
Sandalfoot Cove|FL|US|26.34|-80.19
Brenham|TX|US|30.17|-96.4
Roseau|Saint George Parish|DM|15.3|-61.39
Opa-locka|FL|US|25.9|-80.25
Beaver Dam|WI|US|43.46|-88.84
Coalinga|CA|US|36.14|-120.36
Seymour|CT|US|41.4|-73.08
Jenison|MI|US|42.91|-85.79
Cohoes|NY|US|42.77|-73.7
Swansea|MA|US|41.75|-71.19
Donna|TX|US|26.17|-98.05
Vienna|VA|US|38.9|-77.27
Pinewood|FL|US|25.87|-80.22
Lansdale|PA|US|40.24|-75.28
Sevierville|TN|US|35.87|-83.56
Saint Peter Port|St Peter Port|GG|49.46|-2.54
Chickasha|OK|US|35.05|-97.94
Kingsland|GA|US|30.8|-81.69
Lower Moyamensing|PA|US|39.92|-75.16
Uvalde|TX|US|29.21|-99.79
Hillcrest Heights|MD|US|38.83|-76.96
Stuart|FL|US|27.2|-80.25
Fairhaven|MA|US|41.64|-70.9
Avon|IN|US|39.76|-86.4
Zachary|LA|US|30.65|-91.16
Red Wing|MN|US|44.56|-92.53
Sikeston|MO|US|36.88|-89.59
Bethpage|NY|US|40.74|-73.48
Concord|MO|US|38.52|-90.36
Flowing Wells|AZ|US|32.29|-111.01
'Ewa Beach|HI|US|21.32|-158.01
Bridgeview|IL|US|41.75|-87.8
Fairview Park|OH|US|41.44|-81.86
Laguna Woods|CA|US|33.61|-117.73
Mount Clemens|MI|US|42.6|-82.88
Canon City|CO|US|38.44|-105.24
Saint Michael|MN|US|45.21|-93.66
South River|NJ|US|40.45|-74.39
Fort Thomas|KY|US|39.08|-84.45
Sunset|FL|US|25.71|-80.35
Prospect Heights|IL|US|42.1|-87.94
Griffith|IN|US|41.53|-87.42
Estelle|LA|US|29.85|-90.11
Schofield Barracks|HI|US|21.5|-158.07
Bon Air|VA|US|37.52|-77.56
Oconomowoc|WI|US|43.11|-88.5
Hough|OH|US|41.51|-81.64
Vero Beach|FL|US|27.64|-80.4
Sunnyside|WA|US|46.32|-120.01
Lebanon|OR|US|44.54|-122.91
Bayshore Gardens|FL|US|27.43|-82.59
Streetsboro|OH|US|41.24|-81.35
Calhoun|GA|US|34.5|-84.95
Fishtown|PA|US|39.97|-75.14
Morton|IL|US|40.61|-89.46
Menomonie|WI|US|44.88|-91.92
Truckee|CA|US|39.33|-120.18
Fremont|OH|US|41.35|-83.12
Buckhall|VA|US|38.73|-77.43
Gainesville|TX|US|33.63|-97.13
Aberdeen|WA|US|46.98|-123.82
Baychester|NY|US|40.87|-73.84
Hopatcong Hills|NJ|US|40.94|-74.67
Waterville|ME|US|44.55|-69.63
Oroville|CA|US|39.51|-121.56
Roosevelt|NY|US|40.68|-73.59
Laconia|NH|US|43.53|-71.47
Bellmore|NY|US|40.67|-73.53
Nuuanu - Punchbowl|HI|US|21.34|-157.83
Hibbing|MN|US|47.43|-92.94
Sudley|VA|US|38.79|-77.5
Dublin|GA|US|32.54|-82.9
Kuliouou - Kalani Iki|HI|US|21.3|-157.75
Coos Bay|OR|US|43.37|-124.22
Hope Mills|NC|US|34.97|-78.95
Cimarron Hills|CO|US|38.86|-104.7
Katy|TX|US|29.79|-95.82
Brunswick|GA|US|31.15|-81.49
Clarksburg|WV|US|39.28|-80.34
Jollyville|TX|US|30.44|-97.78
Highland Village|TX|US|33.09|-97.05
Ocean Acres|NJ|US|39.74|-74.28
Wolf Trap|VA|US|38.94|-77.29
Madison|NJ|US|40.76|-74.42
Portland|TX|US|27.88|-97.32
Midway|FL|US|30.41|-87.01
Sulphur Springs|TX|US|33.14|-95.6
Maryland City|MD|US|39.09|-76.82
Siloam Springs|AR|US|36.19|-94.54
Ham Lake|MN|US|45.25|-93.25
West Columbia|SC|US|33.99|-81.07
Frankfort|IN|US|40.28|-86.51
Mount Pleasant|TX|US|33.16|-94.97
Dyer|IN|US|41.49|-87.52
Rye|NY|US|40.98|-73.68
Fort Hunt|VA|US|38.73|-77.06
Americus|GA|US|32.07|-84.23
Hermitage|PA|US|41.23|-80.45
Buffalo|MN|US|45.17|-93.87
Crawfordsville|IN|US|40.04|-86.87
Lake Mary|FL|US|28.76|-81.32
Republic|MO|US|37.12|-93.48
Albemarle|NC|US|35.35|-80.2
Cherry Hill|VA|US|38.57|-77.27
El Camino Real|CA|US|33.7|-117.78
Country Walk|FL|US|25.63|-80.43
Riverdale|GA|US|33.57|-84.41
Abington|MA|US|42.1|-70.95
Floral Park|NY|US|40.72|-73.7
Prosper|TX|US|33.24|-96.8
Walnut Park|CA|US|33.97|-118.23
Pecan Grove|TX|US|29.63|-95.73
Overland|MO|US|38.7|-90.36
Grandville|MI|US|42.91|-85.76
Four Corners|OR|US|44.93|-122.98
Sunland Park|NM|US|31.8|-106.58
North Liberty|IA|US|41.75|-91.6
Burlington|KY|US|39.03|-84.72
Parole|MD|US|38.98|-76.55
Vincent|CA|US|34.5|-118.12
Southchase|FL|US|28.39|-81.38
Ukiah|CA|US|39.15|-123.21
La Marque|TX|US|29.37|-94.97
North Arlington|NJ|US|40.79|-74.13
La Palma|CA|US|33.85|-118.05
Seagoville|TX|US|32.64|-96.54
Lebanon|IN|US|40.05|-86.47
Clayton|MO|US|38.64|-90.32
Pearl River|NY|US|41.06|-74.02
Conyers|GA|US|33.67|-84.02
Myrtle Grove|FL|US|30.42|-87.31
Aldine|TX|US|29.93|-95.38
Narragansett|RI|US|41.45|-71.45
Kaukauna|WI|US|44.28|-88.27
Port Washington|NY|US|40.83|-73.7
New Port Richey|FL|US|28.24|-82.72
Aurora|OH|US|41.32|-81.35
Adams Morgan|DC|US|38.92|-77.04
Rutland|VT|US|43.61|-72.97
Asbury Park|NJ|US|40.22|-74.01
Lutherville-Timonium|MD|US|39.44|-76.61
UC Irvine|CA|US|33.64|-117.84
Ashland|MA|US|42.26|-71.46
Hybla Valley|VA|US|38.75|-77.08
Longmeadow|MA|US|42.05|-72.58
Elkton|MD|US|39.61|-75.83
Strawberry Mansion|PA|US|39.98|-75.18
Grosse Pointe Woods|MI|US|42.44|-82.91
Alton|TX|US|26.29|-98.31
Pinehurst|NC|US|35.2|-79.47
Groves|TX|US|29.95|-93.92
West University Place|TX|US|29.72|-95.43
Orient Heights|MA|US|42.39|-71
Wilkinsburg|PA|US|40.44|-79.88
Manassas Park|VA|US|38.78|-77.47
Willow Grove|PA|US|40.14|-75.12
Gatesville|TX|US|31.44|-97.74
Avon Center|OH|US|41.46|-82.02
La Grange|IL|US|41.81|-87.87
Great Bend|KS|US|38.36|-98.76
Shively|KY|US|38.2|-85.82
Highland Springs|VA|US|37.55|-77.33
Hueytown|AL|US|33.45|-87
Talladega|AL|US|33.44|-86.11
New Haven|IN|US|41.07|-85.01
Mill Creek East|WA|US|47.84|-122.19
Koolauloa|HI|US|21.61|-157.93
Middleburg Heights|OH|US|41.36|-81.81
Pacific Grove|CA|US|36.62|-121.92
Mitchell|SD|US|43.71|-98.03
Humble|TX|US|30|-95.26
Greenwood Village|CO|US|39.62|-104.95
Bryn Mawr-Skyway|WA|US|47.49|-122.24
Bradley|IL|US|41.14|-87.86
McKinley Park|IL|US|41.83|-87.67
Elkridge|MD|US|39.21|-76.71
Aberdeen|MD|US|39.51|-76.16
North Myrtle Beach|SC|US|33.82|-78.68
Williamstown|NJ|US|39.69|-75
Long Beach|MS|US|30.35|-89.15
Otsego|MN|US|45.27|-93.59
Boulder City|NV|US|35.98|-114.83
Fillmore|CA|US|34.4|-118.92
Lake Wales|FL|US|27.9|-81.59
Alum Rock|CA|US|37.37|-121.83
Addison|TX|US|32.96|-96.83
East Riverdale|MD|US|38.96|-76.91
Laurinburg|NC|US|34.77|-79.46
Hernando|MS|US|34.82|-89.99
Hurricane|UT|US|37.18|-113.29
Plainfield|CT|US|41.68|-71.92
Hanover|PA|US|39.8|-76.98
Lithia Springs|GA|US|33.79|-84.66
Farmingville|NY|US|40.83|-73.03
Mastic|NY|US|40.8|-72.84
Setauket-East Setauket|NY|US|40.93|-73.1
Harrison|NJ|US|40.75|-74.16
Martha Lake|WA|US|47.85|-122.24
Port Richmond|NY|US|40.63|-74.14
Indianola|IA|US|41.36|-93.56
Perry|GA|US|32.46|-83.73
Atwater Village|CA|US|34.12|-118.26
Jasper|IN|US|38.39|-86.93
Winder|GA|US|33.99|-83.72
Clive|IA|US|41.6|-93.72
Clemson|SC|US|34.68|-82.84
Greenwood|MS|US|33.52|-90.18
Tavares|FL|US|28.8|-81.73
Great Falls|VA|US|39|-77.29
Jamestown|ND|US|46.91|-98.71
Terrace Heights|NY|US|40.72|-73.77
Emerson Hill|NY|US|40.61|-74.1
Avocado Heights|CA|US|34.04|-117.99
Kapolei Villages|HI|US|21.34|-158.07
Eden|NC|US|36.49|-79.77
Bay Village|OH|US|41.48|-81.92
Lake Butler|FL|US|28.5|-81.54
Makakilo City|HI|US|21.35|-158.09
Westbury|NY|US|40.76|-73.59
Bostonia|CA|US|32.81|-116.94
Iona|FL|US|26.52|-81.96
Dickson|TN|US|36.08|-87.39
Newport|KY|US|39.09|-84.5
Cullman|AL|US|34.17|-86.84
Live Oak|TX|US|29.57|-98.34
Roanoke Rapids|NC|US|36.46|-77.65
Payson|AZ|US|34.23|-111.33
Storrs|CT|US|41.81|-72.25
The Dalles|OR|US|45.59|-121.18
Los Lunas|NM|US|34.81|-106.73
Dixon|IL|US|41.84|-89.48
Bellevue|WI|US|44.44|-87.92
Sunland|CA|US|34.27|-118.3
Millbrook|AL|US|32.48|-86.36
Brownsville|FL|US|25.82|-80.24
Wailuku|HI|US|20.89|-156.51
Warren Township|NJ|US|40.61|-74.52
Seaford|NY|US|40.67|-73.49
Washougal|WA|US|45.58|-122.35
Dallas|OR|US|44.92|-123.32
Graniteville|NY|US|40.62|-74.15
Henderson|NC|US|36.33|-78.4
Stallings|NC|US|35.09|-80.69
River Falls|WI|US|44.86|-92.62
Berkley|MI|US|42.5|-83.18
Damascus|MD|US|39.29|-77.2
Shelbyville|KY|US|38.21|-85.22
Kennedy Street|DC|US|38.96|-77.02
Roxbury Crossing|MA|US|42.33|-71.09
Susanville|CA|US|40.42|-120.65
Pataskala|OH|US|40|-82.67
Traverse City|MI|US|44.76|-85.62
South Yuba City|CA|US|39.12|-121.64
Merrifield|VA|US|38.87|-77.23
Ledyard|CT|US|41.44|-72.01
Fords|NJ|US|40.53|-74.32
New Territory|TX|US|29.59|-95.68
Kapolei|HI|US|21.34|-158.06
Clearlake|CA|US|38.96|-122.63
McKinleyville|CA|US|40.95|-124.1
Brunswick|ME|US|43.91|-69.97
Highview|KY|US|38.14|-85.62
Kenmore|NY|US|42.97|-78.87
Belvedere Park|GA|US|33.75|-84.27
Ripon|CA|US|37.74|-121.12
Rossville|MD|US|39.34|-76.48
Depew|NY|US|42.9|-78.69
Seven Oaks|SC|US|34.05|-81.15
Wilmington Island|GA|US|32|-80.97
Parlier|CA|US|36.61|-119.53
Gates-North Gates|NY|US|43.17|-77.7
East Rancho Dominguez|CA|US|33.9|-118.2
Southwest Waterfront|DC|US|38.88|-77.02
Natchez|MS|US|31.56|-91.4
Cloverly|MD|US|39.11|-77
Newton|IA|US|41.7|-93.05
Lamont|CA|US|35.26|-118.91
East Brainerd|TN|US|35|-85.15
Vandalia|OH|US|39.89|-84.2
Rio Linda|CA|US|38.69|-121.45
East Longmeadow|MA|US|42.06|-72.51
Ramsey|NJ|US|41.06|-74.14
West Park|FL|US|25.98|-80.2
Greeneville|TN|US|36.16|-82.83
Mount Vernon|IL|US|38.32|-88.9
Adelphi|MD|US|39|-76.97
Front Royal|VA|US|38.92|-78.19
Weston|WI|US|44.89|-89.55
Spanish Springs|NV|US|39.65|-119.71
Fort Leonard Wood|MO|US|37.71|-92.16
Duxbury|MA|US|42.04|-70.67
Sterling|IL|US|41.79|-89.7
Capitol Hill|DC|US|38.89|-77
Williamsburg|VA|US|37.27|-76.71
Somerton|AZ|US|32.6|-114.71
Three Lakes|FL|US|25.64|-80.4
Auburndale|FL|US|28.07|-81.79
Gloversville|NY|US|43.05|-74.34
Hereford|TX|US|34.82|-102.4
Eggertsville|NY|US|42.96|-78.8
Batavia|NY|US|43|-78.19
Dumas|TX|US|35.87|-101.97
Suffolk Downs Station|MA|US|42.39|-71
Ukrainian Village|IL|US|41.9|-87.68
Bull Run|VA|US|38.78|-77.52
Ammon|ID|US|43.47|-111.97
New River|AZ|US|33.92|-112.14
Kilgore|TX|US|32.39|-94.88
Fullerton|PA|US|40.63|-75.47
Knik-Fairview|AK|US|61.51|-149.6
Hudson|MA|US|42.39|-71.57
Tonawanda|NY|US|43.02|-78.88
Villa Rica|GA|US|33.73|-84.92
North New Hyde Park|NY|US|40.74|-73.69
Johnstown|CO|US|40.34|-104.91
Tolland|CT|US|41.87|-72.37
Canyon|TX|US|34.98|-101.92
Jacksonville|TX|US|31.96|-95.27
Berea|KY|US|37.57|-84.3
Tenafly|NJ|US|40.93|-73.96
Marco|FL|US|25.97|-81.73
East San Gabriel|CA|US|34.11|-118.08
Jackson|MO|US|37.38|-89.67
Corinth|MS|US|34.93|-88.52
Coto De Caza|CA|US|33.6|-117.59
Englewood|FL|US|26.96|-82.35
Crowley|TX|US|32.58|-97.36
Saint John|IN|US|41.45|-87.47
Midlothian|IL|US|41.63|-87.72
Welby|CO|US|39.84|-104.96
Horsham|PA|US|40.18|-75.13
Mastic Beach|NY|US|40.77|-72.85
Grays Ferry|PA|US|39.94|-75.19
Mashpee|MA|US|41.65|-70.48
Powder Springs|GA|US|33.86|-84.68
Masonboro|NC|US|34.18|-77.85
Jennings|MO|US|38.72|-90.26
Head of Westport|MA|US|41.62|-71.06
Scottsbluff|NE|US|41.87|-103.67
Nuuk|Sermersooq|GL|64.18|-51.72
Sierra Vista Southeast|AZ|US|31.45|-110.22
East Highland Park|VA|US|37.58|-77.41
Glen Allen|VA|US|37.67|-77.51
Johnson City|NY|US|42.12|-75.96
Douglaston|NY|US|40.77|-73.75
Mineral Wells|TX|US|32.81|-98.11
Ogontz|PA|US|40.05|-75.15
Cherryland|CA|US|37.68|-122.1
Scottsboro|AL|US|34.67|-86.03
Ozark|AL|US|31.46|-85.64
Alexander City|AL|US|32.94|-85.95
Lady Lake|FL|US|28.92|-81.92
Niceville|FL|US|30.52|-86.48
West Norriton|PA|US|40.13|-75.38
Owosso|MI|US|43|-84.18
Blytheville|AR|US|35.93|-89.92
Ellington|CT|US|41.9|-72.47
Whitewater|WI|US|42.83|-88.73
Lebanon|MO|US|37.68|-92.66
North Fair Oaks|CA|US|37.47|-122.2
Hollins|VA|US|37.34|-79.94
Forrest City|AR|US|35.01|-90.79
Parkway|CA|US|38.5|-121.46
Colesville|MD|US|39.08|-77
Graham|NC|US|36.07|-79.4
Cinnaminson|NJ|US|40|-74.99
Fraser|MI|US|42.54|-82.95
Chaparral|NM|US|32.02|-106.39
Clark|NJ|US|40.63|-74.31
Norridge|IL|US|41.96|-87.83
Hammonton|NJ|US|39.64|-74.8
Zephyrhills|FL|US|28.23|-82.18
College Park|GA|US|33.65|-84.45
Groveton|VA|US|38.77|-77.08
Bemidji|MN|US|47.47|-94.88
Hawaiian Gardens|CA|US|33.83|-118.07
Bloomsburg|PA|US|41|-76.45
Thibodaux|LA|US|29.8|-90.82
Valle Vista|CA|US|33.75|-116.89
Alamo|CA|US|37.85|-122.03
Druid Hills|GA|US|33.78|-84.34
Yankton|SD|US|42.87|-97.4
Beech Grove|IN|US|39.72|-86.09
Cedar Mill|OR|US|45.52|-122.81
Lake Saint Louis|MO|US|38.8|-90.79
Northview|MI|US|43.05|-85.6
Harrisburg|NC|US|35.32|-80.66
Warrington|FL|US|30.38|-87.27
Royal Kunia|HI|US|21.39|-158.03
Deming|NM|US|32.27|-107.76
Greece|NY|US|43.21|-77.69
Springdale|NJ|US|39.88|-74.97
Phillipsburg|NJ|US|40.69|-75.19
Hopatcong|NJ|US|40.93|-74.66
Worthington|OH|US|40.09|-83.02
Whitman|MA|US|42.08|-70.94
Greensburg|PA|US|40.3|-79.54
Hartselle|AL|US|34.44|-86.94
Miami Springs|FL|US|25.82|-80.29
South Farmingdale|NY|US|40.72|-73.44
East Islip|NY|US|40.73|-73.19
Kerman|CA|US|36.72|-120.06
Warsaw|IN|US|41.24|-85.85
Glasgow|KY|US|37|-85.91
Union Square|MA|US|42.38|-71.1
North Branford|CT|US|41.33|-72.77
Fairview|NJ|US|40.81|-74
Springfield|NJ|US|40.7|-74.32
Chubbuck|ID|US|42.92|-112.47
Scott Lake|FL|US|25.94|-80.23
Robbinsdale|MN|US|45.03|-93.34
Franklin Park|PA|US|40.58|-80.09
Lindenhurst|IL|US|42.41|-88.03
Bridgetown|OH|US|39.15|-84.64
Callaway|FL|US|30.15|-85.57
Rio Grande City|TX|US|26.38|-98.82
Pineville|LA|US|31.32|-92.43
Cahokia|IL|US|38.57|-90.19
Sarasota Springs|FL|US|27.31|-82.48
Mill Valley|CA|US|37.91|-122.54
Hugo|MN|US|45.16|-92.99
Moultrie|GA|US|31.18|-83.79
Brooklyn Park|MD|US|39.23|-76.62
Chicago Ridge|IL|US|41.7|-87.78
Cutlerville|MI|US|42.84|-85.66
Morris|IL|US|41.36|-88.42
Hartford|WI|US|43.32|-88.38
Brookside|DE|US|39.67|-75.73
Highland Park|NJ|US|40.5|-74.42
Beacon|NY|US|41.5|-73.97
Woodcrest|CA|US|33.88|-117.36
Greendale|WI|US|42.94|-88
Antioch|IL|US|42.48|-88.1
Hunters Creek|FL|US|28.36|-81.42
Carthage|MO|US|37.18|-94.31
Manorville|NY|US|40.87|-72.81
Phelan|CA|US|34.43|-117.57
Glasgow|DE|US|39.6|-75.75
Berea|SC|US|34.89|-82.46
Glens Falls|NY|US|43.31|-73.64
Los Osos|CA|US|35.31|-120.83
New Franklin|OH|US|40.94|-81.54
Hershey|PA|US|40.29|-76.65
Knightdale|NC|US|35.79|-78.48
Hewitt|TX|US|31.46|-97.2
Allegheny West|PA|US|40.01|-75.18
Alpine|CA|US|32.84|-116.77
Gibsonton|FL|US|27.85|-82.38
Gantt|SC|US|34.8|-82.42
Lakeway|TX|US|30.36|-97.98
Moorestown-Lenola|NJ|US|39.97|-74.96
Murraysville|NC|US|34.3|-77.85
Canton|IL|US|40.56|-90.04
Bradley Gardens|NJ|US|40.56|-74.65
Elk Plain|WA|US|47.05|-122.4
Camano|WA|US|48.17|-122.53
Bayou Boeuf|LA|US|29.87|-90.6
Grand Bayou Mobile Home Park|LA|US|29.91|-90.78
Berkeley Heights|NJ|US|40.68|-74.44
Mount Holly|NC|US|35.3|-81.02
Cherry Hill Mall|NJ|US|39.94|-75.01
Oldsmar|FL|US|28.03|-82.67
Fort Payne|AL|US|34.44|-85.72
Wykagyl|NY|US|40.94|-73.8
Jefferson Valley-Yorktown|NY|US|41.32|-73.8
Five Forks|SC|US|34.8|-82.23
Hayden|ID|US|47.77|-116.79
Roxborough|PA|US|40.04|-75.22
Red Bluff|CA|US|40.18|-122.24
New Fairfield|CT|US|41.47|-73.49
Forest Park|IL|US|41.88|-87.81
Hickory Hills|IL|US|41.73|-87.83
Hyannis|MA|US|41.65|-70.28
Arverne|NY|US|40.59|-73.8
Hazel Crest|IL|US|41.57|-87.69
Whitefish Bay|WI|US|43.11|-87.9
Weehawken|NJ|US|40.77|-74.02
Sterling|CO|US|40.63|-103.21
North Reading|MA|US|42.58|-71.08
Indiana|PA|US|40.62|-79.15
Pierre|SD|US|44.37|-100.35
Fish Hawk|FL|US|27.85|-82.21
Longwood|FL|US|28.7|-81.34
Barracks Row|DC|US|38.88|-77
Jasper|AL|US|33.83|-87.28
Reidsville|NC|US|36.35|-79.66
Dentsville|SC|US|34.06|-80.96
Northbridge|MA|US|42.15|-71.65
New Cassel|NY|US|40.76|-73.57
Rosedale|CA|US|35.38|-119.15
Apollo Beach|FL|US|27.77|-82.41
Waycross|GA|US|31.21|-82.36
Washington|MO|US|38.56|-91.01
Chippewa Falls|WI|US|44.94|-91.39
Westwood|MA|US|42.21|-71.22
Mount Washington|KY|US|38.05|-85.55
East Bridgewater|MA|US|42.03|-70.96
Washington Court House|OH|US|39.54|-83.44
Rocky Point|NY|US|40.95|-72.93
Halawa|HI|US|21.38|-157.92
Holliston|MA|US|42.2|-71.42
Collingswood|NJ|US|39.92|-75.07
Horizon West|FL|US|28.43|-81.62
Elfers|FL|US|28.22|-82.72
McFarland|CA|US|35.68|-119.23
Beach Park|IL|US|42.42|-87.86
Sun Lakes|AZ|US|33.21|-111.88
Fairburn|GA|US|33.57|-84.58
Lincoln|IL|US|40.15|-89.36
Seekonk|MA|US|41.81|-71.34
Upper Grand Lagoon|FL|US|30.16|-85.74
Willowick|OH|US|41.63|-81.47
Orange|CT|US|41.28|-73.03
South Venice|FL|US|27.05|-82.42
Maumee|OH|US|41.56|-83.65
Middlesex|NJ|US|40.57|-74.49
Allouez|WI|US|44.48|-88.02
Paradise Valley|AZ|US|33.53|-111.94
Moberly|MO|US|39.42|-92.44
Wood Dale|IL|US|41.96|-87.98
Covington|GA|US|33.6|-83.86
Saint Simon Mills|GA|US|31.17|-81.41
Levelland|TX|US|33.59|-102.38
Hutchinson|MN|US|44.89|-94.37
Saraland|AL|US|30.82|-88.07
King City|CA|US|36.21|-121.13
Livingston|CA|US|37.39|-120.72
Marietta|OH|US|39.42|-81.45
Falls Church|VA|US|38.88|-77.17
Metuchen|NJ|US|40.54|-74.36
Olean|NY|US|42.08|-78.43
Oneonta|NY|US|42.45|-75.06
Ephrata|PA|US|40.18|-76.18
Circleville|OH|US|39.6|-82.95
Forest City|FL|US|28.67|-81.44
Harper Woods|MI|US|42.43|-82.92
Princeton Meadows|NJ|US|40.33|-74.56
Whitehall|PA|US|40.36|-79.99
Sault Ste. Marie|MI|US|46.5|-84.35
Andrews|TX|US|32.32|-102.55
Hendersonville|NC|US|35.32|-82.46
Wauconda|IL|US|42.26|-88.14
Fort Carson|CO|US|38.74|-104.79
Oak Park|CA|US|34.18|-118.76
Stanford|CA|US|37.42|-122.17
Pottsville|PA|US|40.69|-76.2
Homosassa Springs|FL|US|28.8|-82.58
Ladson|SC|US|32.99|-80.11
Swampscott|MA|US|42.47|-70.92
Auburn|CA|US|38.9|-121.08
Sharonville|OH|US|39.27|-84.41
Elizabethton|TN|US|36.35|-82.21
Clarksburg|MD|US|39.24|-77.28
McMinnville|TN|US|35.68|-85.77
Cromwell|CT|US|41.6|-72.65
Buford|GA|US|34.12|-84
Wixom|MI|US|42.52|-83.54
West Richland|WA|US|46.3|-119.36
Greenlawn|NY|US|40.87|-73.37
Stony Brook|NY|US|40.93|-73.14
Mountain Home|ID|US|43.13|-115.69
Waimalu|HI|US|21.39|-157.94
Carpinteria|CA|US|34.4|-119.52
Salida|CA|US|37.71|-121.08
Sienna Plantation|TX|US|29.49|-95.51
Seabrook|TX|US|29.56|-95.03
Gardendale|AL|US|33.66|-86.81
Hidalgo|TX|US|26.1|-98.26
Muscle Shoals|AL|US|34.74|-87.67
Buda|TX|US|30.09|-97.84
Mebane|NC|US|36.1|-79.27
Baker|LA|US|30.59|-91.17
Richton Park|IL|US|41.48|-87.7
Lyndhurst|OH|US|41.52|-81.49
Athens|TN|US|35.44|-84.59
Fort Campbell North|KY|US|36.65|-87.46
East Greenwich|RI|US|41.66|-71.46
Palos Verdes Estates|CA|US|33.8|-118.39
Canton|MS|US|32.61|-90.04
Boerne|TX|US|29.79|-98.73
Roselle Park|NJ|US|40.66|-74.26
Fort Mill|SC|US|35.01|-80.95
East Wenatchee|WA|US|47.42|-120.29
Olivehurst|CA|US|39.1|-121.55
Moss Point|MS|US|30.41|-88.53
Bexley|OH|US|39.97|-82.94
Marshall|MN|US|44.45|-95.79
Pell City|AL|US|33.59|-86.29
Martinsville|VA|US|36.69|-79.87
Monroe|GA|US|33.79|-83.71
Copley|OH|US|41.1|-81.64
Cayce|SC|US|33.97|-81.07
West Freehold|NJ|US|40.24|-74.3
Miami|OK|US|36.87|-94.88
La Grange Park|IL|US|41.83|-87.86
Port Orchard|WA|US|47.54|-122.64
Millbury|MA|US|42.19|-71.76
Hampton Bays|NY|US|40.87|-72.52
Grover Beach|CA|US|35.12|-120.62
Bergen Beach|NY|US|40.62|-73.91
East Norriton|PA|US|40.15|-75.34
Lebanon|NH|US|43.64|-72.25
Lewisville|NC|US|36.1|-80.42
Jericho|NY|US|40.79|-73.54
Hudson|WI|US|44.97|-92.76
Sharon|PA|US|41.23|-80.49
Verona|NJ|US|40.83|-74.24
Swansea|IL|US|38.53|-89.99
Warrensville Heights|OH|US|41.44|-81.54
Southern Pines|NC|US|35.17|-79.39
Riverdale|IL|US|41.63|-87.63
Henderson|TX|US|32.15|-94.8
Glenmont|MD|US|39.06|-77.05
North Mankato|MN|US|44.17|-94.03
Hockessin|DE|US|39.79|-75.7
Destin|FL|US|30.39|-86.5
Mount Dora|FL|US|28.8|-81.64
Lynden|WA|US|48.95|-122.45
Naranja|FL|US|25.52|-80.42
Havre de Grace|MD|US|39.55|-76.09
Palmetto Estates|FL|US|25.62|-80.36
Washington|PA|US|40.17|-80.25
Waxhaw|NC|US|34.92|-80.74
White Center|WA|US|47.52|-122.35
River Ridge|LA|US|29.96|-90.22
Olympia Heights|FL|US|25.73|-80.36
Village of Campton Hills|IL|US|41.94|-88.4
Conway|FL|US|28.5|-81.33
Glenn Dale|MD|US|38.99|-76.82
San Marino|CA|US|34.12|-118.11
Englewood|OH|US|39.88|-84.3
Orangeburg|SC|US|33.49|-80.86
Solana Beach|CA|US|32.99|-117.27
Timberwood Park|TX|US|29.69|-98.5
Lockhart|TX|US|29.88|-97.67
Brecksville|OH|US|41.32|-81.63
Cambridgeport|MA|US|42.36|-71.1
Washington Square|PA|US|39.95|-75.16
Chesterton|IN|US|41.61|-87.06
Sauk Rapids|MN|US|45.59|-94.17
South Park Township|PA|US|40.3|-79.99
Oatfield|OR|US|45.41|-122.6
Halawa Heights|HI|US|21.38|-157.91
Monroe|OH|US|39.44|-84.36
Kings Park West|VA|US|38.81|-77.3
Nesconset|NY|US|40.85|-73.15
Las Vegas|NM|US|35.59|-105.22
Belmopan|Cayo District|BZ|17.25|-88.76
Grain Valley|MO|US|39.02|-94.2
Dunmore|PA|US|41.42|-75.63
Avarua|Rarotonga|CK|-21.21|-159.78
Brainerd|MN|US|46.36|-94.2
Western Springs|IL|US|41.81|-87.9
Discovery Bay|CA|US|37.91|-121.6
Bedford|IN|US|38.86|-86.49
Bellair-Meadowbrook Terrace|FL|US|30.18|-81.74
Saint James|NY|US|40.88|-73.16
Ridge|NY|US|40.89|-72.9
New Ulm|MN|US|44.31|-94.46
South Sioux City|NE|US|42.47|-96.41
Warrenville|IL|US|41.82|-88.17
Huron|SD|US|44.36|-98.21
Shorewood|WI|US|43.09|-87.89
Waunakee|WI|US|43.19|-89.46
Beaufort|SC|US|32.43|-80.67
Avenal|CA|US|36|-120.13
Monticello|MN|US|45.31|-93.79
Riverhead|NY|US|40.92|-72.66
West Carrollton City|OH|US|39.67|-84.25
Franklin Park|NJ|US|40.44|-74.54
Piney Green|NC|US|34.72|-77.32
Butler|PA|US|40.86|-79.9
Citrus Ridge|FL|US|28.33|-81.64
Fergus Falls|MN|US|46.28|-96.08
Beeville|TX|US|28.4|-97.75
California City|CA|US|35.13|-117.99
Gonzalez|FL|US|30.58|-87.29
Vadnais Heights|MN|US|45.06|-93.07
North Adams|MA|US|42.7|-73.11
Palmetto|FL|US|27.52|-82.57
Lake Forest Park|WA|US|47.76|-122.28
Spring Lake|NC|US|35.17|-78.97
Mercerville|NJ|US|40.24|-74.69
Colonial Park|PA|US|40.3|-76.81
Glenpool|OK|US|35.96|-96.01
Fruitville|FL|US|27.33|-82.46
Red Hill|SC|US|34|-79.26
Lindsay|CA|US|36.2|-119.09
Calera|AL|US|33.1|-86.75
University Heights|OH|US|41.5|-81.54
Torshavn|Streymoy|FO|62.01|-6.77
Carriere|MS|US|30.62|-89.65
Atlantic Beach|FL|US|30.33|-81.4
Streator|IL|US|41.12|-88.84
Lea Hill|WA|US|47.33|-122.18
Waianae|HI|US|21.44|-158.19
Teays Valley|WV|US|38.45|-81.93
Lone Tree|CO|US|39.55|-104.89
Brandermill|VA|US|37.43|-77.65
Soddy-Daisy|TN|US|35.24|-85.19
Snoqualmie|WA|US|47.53|-121.83
Fostoria|OH|US|41.16|-83.42
Oakland|NJ|US|41.01|-74.26
Short Hills|NJ|US|40.75|-74.33
Wayland|MA|US|42.36|-71.36
Raynham|MA|US|41.95|-71.07
Coatesville|PA|US|39.98|-75.82
Clayton|OH|US|39.86|-84.36
McPherson|KS|US|38.37|-97.66
Crowley|LA|US|30.21|-92.37
Harrison|AR|US|36.23|-93.11
Saddle Brook|NJ|US|40.9|-74.09
East Cambridge|MA|US|42.37|-71.08
Bellefontaine|OH|US|40.36|-83.76
Black Forest|CO|US|39.01|-104.7
Ridgefield Park|NJ|US|40.86|-74.02
Grovetown|GA|US|33.45|-82.2
Bardstown|KY|US|37.81|-85.47
Windham|NH|US|42.8|-71.3
Worthington|MN|US|43.62|-95.6
Florida City|FL|US|25.45|-80.48
Commerce|CA|US|34|-118.16
La Grande|OR|US|45.32|-118.09
Saint Marys|PA|US|41.43|-78.56
Stoughton|WI|US|42.92|-89.22
Kingsgate|WA|US|47.73|-122.18
Geneva|NY|US|42.87|-76.98
Meadville|PA|US|41.64|-80.15
Lockhart|FL|US|28.62|-81.44
Harwich|MA|US|41.69|-70.08
South Charleston|WV|US|38.37|-81.7
Medway|MA|US|42.14|-71.4
Marshall|MO|US|39.12|-93.2
Santa Fe|TX|US|29.38|-95.11
Newton|NC|US|35.67|-81.22
North Auburn|CA|US|38.93|-121.08
Tehachapi|CA|US|35.13|-118.45
Saint Ann|MO|US|38.73|-90.38
Thonotosassa|FL|US|28.06|-82.3
Endicott|NY|US|42.1|-76.05
Connersville|IN|US|39.64|-85.14
Arrochar|NY|US|40.6|-74.07
Ferndale|WA|US|48.85|-122.59
Middleburg|FL|US|30.07|-81.86
Rantoul|IL|US|40.31|-88.16
Greenville|OH|US|40.1|-84.63
Saint Simons Island|GA|US|31.15|-81.37
Shadow Hills|CA|US|34.26|-118.35
Woodward|OK|US|36.43|-99.39
Rochester|MI|US|42.68|-83.13
Key Biscayne|FL|US|25.69|-80.16
Mid-Cambridge|MA|US|42.37|-71.11
Claremont|NH|US|43.38|-72.35
Superior|CO|US|39.95|-105.17
Auburn|IN|US|41.37|-85.06
Saint Augustine|FL|US|29.89|-81.31
Powell|OH|US|40.16|-83.08
Justice|IL|US|41.74|-87.84
Glen Carbon|IL|US|38.75|-89.98
West Monroe|LA|US|32.52|-92.15
Malibu|CA|US|34.03|-118.78
Borger|TX|US|35.67|-101.4
College|AK|US|64.86|-147.8
Shiloh|IL|US|38.56|-89.9
Fort Drum|NY|US|44.06|-75.76
Grass Valley|CA|US|39.22|-121.06
Newington|VA|US|38.74|-77.18
Greenwich|CT|US|41.03|-73.63
Lakeland North|WA|US|47.33|-122.28
Kingston|PA|US|41.26|-75.9
Fulton|MO|US|38.85|-91.95
El Dorado|KS|US|37.82|-96.86
Wawarsing|NY|US|41.76|-74.36
Basseterre|Saint George Basseterre|KN|17.3|-62.72
Mounds View|MN|US|45.1|-93.21
Herrin|IL|US|37.8|-89.03
Grenada|MS|US|33.77|-89.81
Dover|OH|US|40.52|-81.47
Hanover|NJ|US|40.8|-74.37
Dardenne Prairie|MO|US|38.77|-90.73
Saint Helens|OR|US|45.86|-122.81
Forest Hill|TX|US|32.67|-97.27
Weigelstown|PA|US|39.98|-76.82
Dallas|GA|US|33.92|-84.84
Glendale|WI|US|43.14|-87.94
York Beach|ME|US|43.17|-70.61
Holiday City-Berkeley|NJ|US|39.96|-74.28
Hot Springs Village|AR|US|34.67|-93
Fruita|CO|US|39.16|-108.73
Kettering|MD|US|38.88|-76.81
Athens|TX|US|32.2|-95.86
New Carrollton|MD|US|38.97|-76.88
Port Neches|TX|US|29.99|-93.96
Hamilton Square|NJ|US|40.23|-74.65
Fallsburg|NY|US|41.73|-74.6
Charlton|MA|US|42.14|-71.97
Seaside|NY|US|40.58|-73.83
Bedford|OH|US|41.39|-81.54
Andover|KS|US|37.71|-97.14
Finneytown|OH|US|39.2|-84.52
Canton|MD|US|39.28|-76.57
Elk City|OK|US|35.41|-99.4
New Kensington|PA|US|40.57|-79.76
Conneaut|OH|US|41.95|-80.55
Derby|CT|US|41.32|-73.09
Boone|IA|US|42.06|-93.88
Minden|LA|US|32.62|-93.29
Middle Valley|TN|US|35.2|-85.18
Markham|IL|US|41.59|-87.69
Belle Chasse|LA|US|29.85|-89.99
Riviera Beach|MD|US|39.17|-76.51
Pelham|NH|US|42.73|-71.32
Pedley|CA|US|33.98|-117.48
El Sobrante|CA|US|37.98|-122.3
On Top of the World|FL|US|29.12|-82.29
Nanakuli|HI|US|21.39|-158.15
McComb|MS|US|31.24|-90.45
Sylacauga|AL|US|33.17|-86.25
Half Moon Bay|CA|US|37.46|-122.43
Lilburn|GA|US|33.89|-84.14
Centralia|IL|US|38.53|-89.13
West Valley|WA|US|46.59|-120.61
San Anselmo|CA|US|37.97|-122.56
Artondale|WA|US|47.3|-122.62
Lincolnwood|IL|US|42|-87.73
West Mount Airy|PA|US|40.05|-75.2
Panama City Beach|FL|US|30.18|-85.81
Montgomeryville|PA|US|40.25|-75.24
Palolo|HI|US|21.31|-157.78
Joppatowne|MD|US|39.41|-76.36
Uxbridge|MA|US|42.08|-71.63
Winter Hill|MA|US|42.4|-71.1
Effingham|IL|US|39.12|-88.54
Eufaula|AL|US|31.89|-85.15
Channahon|IL|US|41.43|-88.23
Moody|AL|US|33.59|-86.49
Loveland|OH|US|39.27|-84.26
South Daytona|FL|US|29.17|-81
Saddlebrooke|AZ|US|32.54|-110.9
Platteville|WI|US|42.73|-90.48
Gaffney|SC|US|35.07|-81.65
Kemp Mill|MD|US|39.04|-77.02
Rogers|MN|US|45.19|-93.55
Lumberton|NJ|US|39.97|-74.81
Azalea Park|FL|US|28.54|-81.3
Lakeland|TN|US|35.23|-89.74
Rendon|TX|US|32.58|-97.24
Palos Heights|IL|US|41.67|-87.8
Wickliffe|OH|US|41.61|-81.45
Verona|WI|US|42.99|-89.53
Woodhaven|MI|US|42.14|-83.24
Bonita|CA|US|32.66|-117.03
Kewanee|IL|US|41.25|-89.92
Woodland Park|NJ|US|40.89|-74.19
Bainbridge|GA|US|30.9|-84.58
Cambridge|MD|US|38.56|-76.08
Bedford|MA|US|42.49|-71.28
Windsor Locks|CT|US|41.93|-72.63
Winnetka|IL|US|42.11|-87.74
New Providence|NJ|US|40.7|-74.4
Green River|WY|US|41.53|-109.47
Grand Terrace|CA|US|34.03|-117.31
Patchogue|NY|US|40.77|-73.02
Cedar Grove|NJ|US|40.85|-74.23
Ardmore|PA|US|40.01|-75.29
Paschall|PA|US|39.92|-75.24
Wilmington|OH|US|39.45|-83.83
Ringwood|NJ|US|41.11|-74.25
North Madison|IN|US|38.77|-85.4
Steamboat Springs|CO|US|40.48|-106.83
Abbeville|LA|US|29.97|-92.13
Fort Atkinson|WI|US|42.93|-88.84
Lake Arrowhead|CA|US|34.25|-117.19
Irondale|AL|US|33.54|-86.71
Lumberton|TX|US|30.27|-94.2
Larkspur|CA|US|37.93|-122.54
Port Lavaca|TX|US|28.61|-96.63
Mount Vernon|VA|US|38.71|-77.1
Brookhaven|MS|US|31.58|-90.44
Fernway|PA|US|40.69|-80.13
Beatrice|NE|US|40.27|-96.75
Ottawa|KS|US|38.62|-95.27
Wilton Manors|FL|US|26.16|-80.14
Four Corners|TX|US|29.67|-95.66
Federal Heights|CO|US|39.85|-105
Downtown|HI|US|21.3|-157.86
Greenwood|WA|US|47.69|-122.35
Spring Creek|NV|US|40.73|-115.59
New Baltimore|MI|US|42.68|-82.74
Forestville|MD|US|38.85|-76.87
Agate Beach|OR|US|44.68|-124.06
Atco|NJ|US|39.77|-74.89
Mandeville|LA|US|30.36|-90.07
Fernandina Beach|FL|US|30.67|-81.46
Miller Place|NY|US|40.96|-73
Escanaba|MI|US|45.75|-87.06
Mountain Home|AR|US|36.34|-92.39
Lake Los Angeles|CA|US|34.61|-117.83
Cleveland|MS|US|33.74|-90.72
Portland|TN|US|36.58|-86.52
Gulfport|FL|US|27.75|-82.7
Plover|WI|US|44.46|-89.54
Cornelius|OR|US|45.52|-123.06
Broadlands|VA|US|39.02|-77.52
Northlake|IL|US|41.92|-87.9
Big Bear City|CA|US|34.26|-116.85
North Castle|NY|US|41.14|-73.68
Eatontown|NJ|US|40.3|-74.05
Coolidge|AZ|US|32.98|-111.52
Marion|AR|US|35.21|-90.2
Turtle Rock|CA|US|33.64|-117.81
West Plains|MO|US|36.73|-91.85
Plymouth|CT|US|41.67|-73.05
Trenton|OH|US|39.48|-84.46
Overlea|MD|US|39.36|-76.52
North Merrick|NY|US|40.69|-73.56
Port Saint John|FL|US|28.48|-80.79
Green Valley|MD|US|39.31|-77.3
Okmulgee|OK|US|35.62|-95.96
South Miami|FL|US|25.71|-80.29
Hasbrouck Heights|NJ|US|40.86|-74.08
Jacksonville|AL|US|33.81|-85.76
Cedarbrook|PA|US|40.08|-75.18
Marysville|CA|US|39.15|-121.59
Clarkston|GA|US|33.81|-84.24
Kingston|MA|US|41.99|-70.72
Davidson|NC|US|35.5|-80.84
Winfield|KS|US|37.24|-97
Red Bank|NJ|US|40.35|-74.06
Somerville|NJ|US|40.57|-74.61
Kings Point|FL|US|26.45|-80.14
East Hanover|NJ|US|40.82|-74.36
Tucson Estates|AZ|US|32.19|-111.09
Haverstraw|NY|US|41.2|-73.96
Suamico|WI|US|44.63|-88.04
Union Market|DC|US|38.91|-77
Timberlake|VA|US|37.32|-79.26
Riverview|MI|US|42.17|-83.18
Choctaw|OK|US|35.5|-97.27
Lake City|FL|US|30.19|-82.64
Babylon|NY|US|40.7|-73.33
Travilah|MD|US|39.07|-77.26
Blue Ash|OH|US|39.23|-84.38
Hudson|FL|US|28.36|-82.69
Neosho|MO|US|36.87|-94.37
Baraboo|WI|US|43.47|-89.74
Freeport|TX|US|28.95|-95.36
Stony Point|NY|US|41.23|-73.99
Richmond|TX|US|29.58|-95.76
Arkansas City|KS|US|37.06|-97.04
Amherst|OH|US|41.4|-82.22
New Kingman-Butler|AZ|US|35.27|-114.03
Evanston|WY|US|41.27|-110.96
Speedway|IN|US|39.8|-86.27
Weatherford|OK|US|35.53|-98.71
Port Royal|SC|US|32.38|-80.69
Wells Branch|TX|US|30.45|-97.68
Luling|LA|US|29.93|-90.37
Mount Sinai|NY|US|40.95|-73.03
Brown Deer|WI|US|43.16|-87.96
Salisbury|NY|US|40.75|-73.56
Dunkirk|NY|US|42.48|-79.33
Woodmere|LA|US|29.86|-90.08
Washington|IN|US|38.66|-87.17
Cloquet|MN|US|46.72|-92.46
Festus|MO|US|38.22|-90.4
Chelsea|AL|US|33.34|-86.63
Poquoson|VA|US|37.12|-76.35
Irmo|SC|US|34.09|-81.18
Lake Station|IN|US|41.58|-87.24
Glenn Heights|TX|US|32.55|-96.86
Madison|IN|US|38.74|-85.38
Goldenrod|FL|US|28.61|-81.29
Norton|OH|US|41.03|-81.64
Artesia|NM|US|32.84|-104.4
Edgewater|NJ|US|40.83|-73.98
Fairfax Station|VA|US|38.8|-77.33
Stafford|CT|US|41.98|-72.29
Centerton|AR|US|36.36|-94.29
Smithfield|NC|US|35.51|-78.34
Red Oak|TX|US|32.52|-96.8
Los Alamos|NM|US|35.89|-106.31
North Palm Beach|FL|US|26.82|-80.08
Clawson|MI|US|42.53|-83.15
Salem|OH|US|40.9|-80.86
Cedar Lake|IN|US|41.36|-87.44
Fortuna|CA|US|40.6|-124.16
Glen Rock|NJ|US|40.96|-74.13
Firestone|CO|US|40.11|-104.94
Portales|NM|US|34.19|-103.33
Gladstone|OR|US|45.38|-122.59
La Homa|TX|US|26.25|-98.36
Martinsville|NJ|US|40.6|-74.56
Kailua-Kona|HI|US|19.64|-156
Waconia|MN|US|44.85|-93.79
Shepherdsville|KY|US|37.99|-85.72
Crestwood|MO|US|38.56|-90.38
Youngsville|LA|US|30.1|-91.99
North Wantagh|NY|US|40.69|-73.51
Freehold|NJ|US|40.26|-74.27
Monfort Heights|OH|US|39.19|-84.6
Scotts Valley|CA|US|37.05|-122.01
Holly Hill|FL|US|29.24|-81.04
Leeds|AL|US|33.55|-86.54
Richmond Hill|GA|US|31.94|-81.3
Bogalusa|LA|US|30.79|-89.85
Bennsville|MD|US|38.61|-77.01
Dranesville|VA|US|39|-77.35
Guymon|OK|US|36.68|-101.48
West Haven|UT|US|41.2|-112.05
Bucyrus|OH|US|40.81|-82.98
Kelso|WA|US|46.15|-122.91
Pennsville|NJ|US|39.65|-75.52
Georgetown|DC|US|38.9|-77.06
Maryville|MO|US|40.35|-94.87
Clayton|CA|US|37.94|-121.94
California|MD|US|38.3|-76.51
Lakeside|VA|US|37.61|-77.48
Terryville|NY|US|40.91|-73.07
Wanaque|NJ|US|41.04|-74.29
Cypress Lake|FL|US|26.54|-81.9
Alexandria|MN|US|45.89|-95.38
Westwood Lake|FL|US|25.73|-80.37
Morgan City|LA|US|29.7|-91.21
Florham Park|NJ|US|40.79|-74.39
Kingsburg|CA|US|36.51|-119.55
Georgetown|GA|US|31.98|-81.23
Greensburg|IN|US|39.34|-85.48
Cottonwood|AZ|US|34.74|-112.01
Schiller Park|IL|US|41.96|-87.87
Lovington|NM|US|32.94|-103.35
Sugarland Run|VA|US|39.04|-77.38
Pontiac|IL|US|40.88|-88.63
Anacostia|DC|US|38.87|-76.98
Bridgeton|MO|US|38.77|-90.41
Franklin|OH|US|39.56|-84.3
Woodinville|WA|US|47.75|-122.16
Colorado Triangle|DC|US|38.96|-77.03
Red Bank|TN|US|35.11|-85.29
Newport East|RI|US|41.52|-71.29
Snyder|TX|US|32.72|-100.92
Lansing|KS|US|39.25|-94.9
Carroll Park|PA|US|39.97|-75.24
Beachwood|OH|US|41.46|-81.51
Lower Burrell|PA|US|40.55|-79.76
Trophy Club|TX|US|33|-97.18
Somersworth|NH|US|43.26|-70.87
Landenberg|PA|US|39.78|-75.77
Healdsburg|CA|US|38.61|-122.87
Blackfoot|ID|US|43.19|-112.34
South Lyon|MI|US|42.46|-83.65
Roosevelt Island|NY|US|40.76|-73.95
Douglas|GA|US|31.51|-82.85
Carver|MA|US|41.88|-70.76
Wallington|NJ|US|40.85|-74.11
Ocean Pines|MD|US|38.4|-75.16
Jensen Beach|FL|US|27.25|-80.23
Lahaina|HI|US|20.88|-156.68
Foothill Ranch|CA|US|33.69|-117.66
Emeryville|CA|US|37.83|-122.29
Azle|TX|US|32.9|-97.55
East Bethel|MN|US|45.32|-93.2
West Henrietta|NY|US|43.04|-77.66
Martinsville|IN|US|39.43|-86.43
Seven Hills|OH|US|41.4|-81.68
Macedonia|OH|US|41.31|-81.51
Weston|MA|US|42.37|-71.3
Waipio|HI|US|21.42|-158
Magnolia|AR|US|33.27|-93.24
River Edge|NJ|US|40.93|-74.04
Oquirrh|UT|US|40.63|-112.03
Guttenberg|NJ|US|40.79|-74
Mexico|MO|US|39.17|-91.88
North Lindenhurst|NY|US|40.71|-73.38
Wyandanch|NY|US|40.75|-73.36
Goshen|OH|US|39.23|-84.16
Lexington Park|MD|US|38.27|-76.45
Arlington|TN|US|35.3|-89.66
Ravenna|OH|US|41.16|-81.24
Enumclaw|WA|US|47.2|-121.99
Oskaloosa|IA|US|41.3|-92.64
Verde Village|AZ|US|34.71|-112.01
El Campo|TX|US|29.2|-96.27
Lynnfield|MA|US|42.54|-71.05
Cocoa Beach|FL|US|28.32|-80.61
Elizabethtown|PA|US|40.15|-76.6
Mack|OH|US|39.16|-84.65
Robstown|TX|US|27.79|-97.67
Port Washington|WI|US|43.39|-87.88
Lakeland South|WA|US|47.28|-122.28
Home Gardens|CA|US|33.88|-117.52
Villas|FL|US|26.55|-81.87
Upper Montclair|NJ|US|40.85|-74.2
Signal Hill|CA|US|33.8|-118.17
Sun Village|CA|US|34.56|-117.96
Archdale|NC|US|35.91|-79.97
Tarrytown|NY|US|41.08|-73.86
Moss Bluff|LA|US|30.3|-93.19
Mountain Park|GA|US|33.84|-84.13
Fulton|NY|US|43.32|-76.42
Garden City|ID|US|43.62|-116.24
Urbana|OH|US|40.11|-83.75
Valley Falls|RI|US|41.91|-71.39
North Bellport|NY|US|40.77|-72.94
Troy|MO|US|38.98|-90.98
Lakeland Village|CA|US|33.64|-117.34
Tomball|TX|US|30.1|-95.62
Greatwood|TX|US|29.55|-95.68
Gladeview|FL|US|25.84|-80.24
Destrehan|LA|US|29.94|-90.35
Cheney|WA|US|47.49|-117.58
West Kensington|PA|US|39.99|-75.14
Richfield|WI|US|43.26|-88.19
Groveland|FL|US|28.56|-81.85
Grafton|WI|US|43.32|-87.95
Shady Hills|FL|US|28.41|-82.54
Yeadon|PA|US|39.94|-75.26
Hobe Sound|FL|US|27.06|-80.14
Byram|MS|US|32.18|-90.25
Claiborne|LA|US|32.52|-92.19
Chesapeake Ranch Estates-Drum Point|MD|US|38.35|-76.42
Pago Pago|Eastern District|AS|-14.28|-170.7
Yulee|FL|US|30.63|-81.61
Excelsior Springs|MO|US|39.34|-94.23
Rehoboth|MA|US|41.84|-71.25
Robinson|TX|US|31.47|-97.11
Cedarburg|WI|US|43.3|-87.99
Gainesville|VA|US|38.8|-77.61
Lewisburg|TN|US|35.45|-86.79
Basse-Terre|Guadeloupe|GP|16|-61.73
Royse City|TX|US|32.98|-96.33
Prairie Ridge|WA|US|47.14|-122.15
Anna|TX|US|33.35|-96.55
Bellmawr|NJ|US|39.87|-75.09
North Saint Paul|MN|US|45.01|-92.99
Hillsborough|CA|US|37.57|-122.38
Los Alamitos|CA|US|33.8|-118.07
Goulds|FL|US|25.56|-80.38
Endwell|NY|US|42.11|-76.02
Clute|TX|US|29.02|-95.4
Fenton|MI|US|42.8|-83.7
Somerset|KY|US|37.09|-84.6
Branson|MO|US|36.64|-93.22
Parker|SC|US|34.85|-82.45
Mendota|CA|US|36.75|-120.38
Lakes by the Bay|FL|US|25.57|-80.33
Mays Chapel|MD|US|39.43|-76.65
Salem|WI|US|42.55|-88.11
Haddonfield|NJ|US|39.89|-75.04
Frederick|CO|US|40.1|-104.94
Webster|MA|US|42.05|-71.88
Crossville|TN|US|35.95|-85.03
Hawaiian Paradise Park|HI|US|19.59|-154.97
D'Iberville|MS|US|30.43|-88.89
Summit|IL|US|41.79|-87.81
Piedmont|CA|US|37.82|-122.23
Ridgefield|NJ|US|40.83|-74.01
Lyndon|KY|US|38.26|-85.6
Ionia|MI|US|42.99|-85.07
Carnot-Moon|PA|US|40.52|-80.22
Newcastle|WA|US|47.54|-122.16
Emmaus|PA|US|40.54|-75.5
Greentree|NJ|US|39.9|-74.96
Tyngsboro|MA|US|42.68|-71.42
Grosse Ile|MI|US|42.13|-83.14
Jefferson Hills|PA|US|40.29|-79.93
Brentwood Village|DC|US|38.92|-76.98
Ocean City|NJ|US|39.28|-74.57
Camden|AR|US|33.58|-92.83
Oxford|CT|US|41.43|-73.12
Waupun|WI|US|43.63|-88.73
Niles|MI|US|41.83|-86.25
North Valley|NM|US|35.17|-106.62
Oak Hills|OR|US|45.54|-122.84
Two Rivers|WI|US|44.15|-87.57
Gloucester City|NJ|US|39.89|-75.12
Lakewood Park|FL|US|27.54|-80.4
Smyrna|DE|US|39.3|-75.6
Fort Morgan|CO|US|40.25|-103.8
Mango|FL|US|27.98|-82.31
Gardnerville Ranchos|NV|US|38.89|-119.74
East Grand Rapids|MI|US|42.94|-85.61
Magalia|CA|US|39.81|-121.58
Broussard|LA|US|30.15|-91.96
Walker Mill|MD|US|38.88|-76.89
West Sedona|AZ|US|34.87|-111.81
Robertsville|NJ|US|40.35|-74.29
Merriam|KS|US|39.02|-94.69
Madison Heights|VA|US|37.43|-79.12
Woods Cross|UT|US|40.87|-111.89
Spearfish|SD|US|44.49|-103.86
Plano|IL|US|41.66|-88.54
Warren|RI|US|41.73|-71.28
The Wharf|DC|US|38.88|-77.02
Shiloh|OH|US|39.82|-84.23
Guthrie|OK|US|35.88|-97.43
Cusseta|GA|US|32.31|-84.77
Huntington|VA|US|38.79|-77.07
Communications Hill|CA|US|37.29|-121.86
Lewis Center|OH|US|40.2|-83.01
Girard Estate|PA|US|39.92|-75.18
Newtonville|MA|US|42.35|-71.2
Wrentham|MA|US|42.07|-71.33
Loganville|GA|US|33.84|-83.9
Westwood|NJ|US|40.99|-74.03
Munhall|PA|US|40.39|-79.9
Yazoo City|MS|US|32.86|-90.41
Minooka|IL|US|41.46|-88.26
Campbellsville|KY|US|37.34|-85.34
Lake Grove|NY|US|40.85|-73.12
Yorktown|IN|US|40.17|-85.49
Southwest Center City Philadelphia|PA|US|39.94|-75.18
White House|TN|US|36.47|-86.65
Browns Mills|NJ|US|39.97|-74.58
Mendota Heights|MN|US|44.88|-93.14
Grosse Pointe Park|MI|US|42.38|-82.94
Shiloh|PA|US|39.98|-76.8
Pike Creek Valley|DE|US|39.74|-75.7
Beachwood|NJ|US|39.94|-74.19
Logan Square|PA|US|39.96|-75.17
Haysville|KS|US|37.56|-97.35
Spencer|IA|US|43.14|-95.14
North Smithfield|RI|US|41.97|-71.55
Orange City|FL|US|28.95|-81.3
Berkley|CO|US|39.8|-105.03
Pompton Lakes|NJ|US|41.01|-74.29
Vernal|UT|US|40.46|-109.53
River Forest|IL|US|41.9|-87.81
Saint Peter|MN|US|44.32|-93.96
Jefferson|LA|US|29.97|-90.15
Jerome|ID|US|42.72|-114.52
Springdale|OH|US|39.29|-84.49
Elwood|NY|US|40.85|-73.34
Grandview|WA|US|46.25|-119.9
Leon Valley|TX|US|29.5|-98.62
North Scituate|RI|US|41.83|-71.59
Webb City|MO|US|37.15|-94.46
Dudley|MA|US|42.05|-71.93
Tarboro|NC|US|35.9|-77.54
Sierra Madre|CA|US|34.16|-118.05
Galena Park|TX|US|29.73|-95.23
Camp Verde|AZ|US|34.56|-111.85
Oakwood|NY|US|40.56|-74.12
Central 14th Street / WMATA Northern Bus Barn|DC|US|38.94|-77.03
Mount Kisco|NY|US|41.2|-73.73
East Renton Highlands|WA|US|47.48|-122.11
Raymondville|TX|US|26.48|-97.78
Chino Valley|AZ|US|34.76|-112.45
Lantana|FL|US|26.59|-80.05
Oneida|NY|US|43.09|-75.65
Gulf Shores|AL|US|30.25|-87.7
Dobbs Ferry|NY|US|41.01|-73.87
Grand Rapids|MN|US|47.24|-93.53
Coshocton|OH|US|40.27|-81.86
Cherry Creek|CO|US|39.61|-104.86
Webster|TX|US|29.54|-95.12
Helena-West Helena|AR|US|34.53|-90.59
Town and Country|MO|US|38.61|-90.46
Lighthouse Point|FL|US|26.28|-80.09
Lawrenceburg|KY|US|38.04|-84.9
Village Park|HI|US|21.4|-158.03
Fredericksburg|TX|US|30.28|-98.87
South Yarmouth|MA|US|41.67|-70.18
Canyon Lake|CA|US|33.69|-117.27
View Park-Windsor Hills|CA|US|34|-118.35
East Milton|FL|US|30.62|-87.02
Leicester|MA|US|42.25|-71.91
Grand Haven|MI|US|43.06|-86.23
Peru|IN|US|40.75|-86.07
Lakeland Highlands|FL|US|27.96|-81.95
Joint Base Lewis McChord|WA|US|47.11|-122.58
Saint Albans|WV|US|38.39|-81.84
Burkburnett|TX|US|34.1|-98.57
Londonderry|NH|US|42.87|-71.37
Diamond Springs|CA|US|38.69|-120.81
Sonoma|CA|US|38.29|-122.46
Millington|TN|US|35.34|-89.9
Little Chute|WI|US|44.28|-88.32
Vermilion-on-the-Lake|OH|US|41.43|-82.32
Suffern|NY|US|41.11|-74.15
Ontario|OR|US|44.03|-116.96
Chalco|NE|US|41.18|-96.15
West Point|MS|US|33.61|-88.65
Crestwood|IL|US|41.64|-87.74
Mountain Top|PA|US|41.17|-75.88
Doctor Phillips|FL|US|28.45|-81.49
Totowa|NJ|US|40.91|-74.21
Spuyten Duyvil|NY|US|40.88|-73.92
Mitchellville|MD|US|38.92|-76.81
Little Ferry|NJ|US|40.85|-74.04
Martin|TN|US|36.34|-88.85
Union|MO|US|38.45|-91.01
Damascus|OR|US|45.42|-122.46
Highland Park|MI|US|42.41|-83.1
Vidor|TX|US|30.13|-94.02
Cordele|GA|US|31.96|-83.78
Bluffdale|UT|US|40.49|-111.94
Malvern|AR|US|34.36|-92.81
Natrona Heights|PA|US|40.62|-79.73
Seymour|TN|US|35.89|-83.72
Quartz Hill|CA|US|34.65|-118.22
Gulf Gate Estates|FL|US|27.25|-82.51
Storm Lake|IA|US|42.64|-95.21
Trinity|FL|US|28.18|-82.68
Fairfield|AL|US|33.49|-86.91
Lincolnton|NC|US|35.47|-81.25
Ironton|OH|US|38.54|-82.68
Franklin Lakes|NJ|US|41.02|-74.21
Brooklyn|OH|US|41.44|-81.74
Newman|CA|US|37.31|-121.02
Summerfield|MD|US|38.9|-76.87
Corning|NY|US|42.14|-77.05
Doraville|GA|US|33.9|-84.28
Sturgis|MI|US|41.8|-85.42
DeRidder|LA|US|30.85|-93.29
Ogdensburg|NY|US|44.69|-75.49
Modena Park|PA|US|40.08|-74.99
Woodbury|NY|US|41.36|-74.11
Taylorville|IL|US|39.55|-89.29
Riverton|WY|US|43.02|-108.38
Citrus|CA|US|34.12|-117.89
Summerfield|NC|US|36.21|-79.9
Show Low|AZ|US|34.25|-110.03
Acushnet|MA|US|41.68|-70.91
Waynesboro|PA|US|39.76|-77.58
East Liverpool|OH|US|40.62|-80.58
Coldwater|MI|US|41.94|-85
Torresdale|PA|US|40.05|-75
Highland City|FL|US|27.97|-81.88
Miami Shores|FL|US|25.86|-80.19
Winchester Center|CT|US|41.9|-73.13
Maltby|WA|US|47.81|-122.11
Burr Ridge|IL|US|41.75|-87.92
Sedro-Woolley|WA|US|48.5|-122.24
Lindon|UT|US|40.34|-111.72
Sweetwater|TX|US|32.47|-100.41
Pine Castle|FL|US|28.47|-81.37
Mount Holly|NJ|US|39.99|-74.79
La Riviera|CA|US|38.57|-121.36
Marinette|WI|US|45.1|-87.63
Bellefontaine Neighbors|MO|US|38.74|-90.23
Van Wert|OH|US|40.87|-84.58
Muskegon Heights|MI|US|43.2|-86.24
Monroe|WI|US|42.6|-89.64
Holbrook|MA|US|42.16|-71.01
Broomall|PA|US|39.98|-75.36
Worth|IL|US|41.69|-87.8
Jacinto City|TX|US|29.77|-95.23
Smithfield|UT|US|41.84|-111.83
Farmersville|CA|US|36.3|-119.21
Crestline|CA|US|34.24|-117.29
Kings Mountain|NC|US|35.25|-81.34
Viera East|FL|US|28.26|-80.71
Lowes Island|VA|US|39.06|-77.35
Delhi|CA|US|37.43|-120.78
Roessleville|NY|US|42.7|-73.81
Sussex|WI|US|43.13|-88.22
Arkadelphia|AR|US|34.12|-93.05
Van Ness|DC|US|38.94|-77.06
Saks|AL|US|33.7|-85.84
Echelon|NJ|US|39.85|-75
Collegedale|TN|US|35.05|-85.05
Vermillion|SD|US|42.78|-96.93
Minneola|FL|US|28.57|-81.75
Upper Roxborough|PA|US|40.06|-75.24
Tamalpais-Homestead Valley|CA|US|37.88|-122.54
Middlesboro|KY|US|36.61|-83.72
Lyons|IL|US|41.81|-87.82
Holly Springs|GA|US|34.17|-84.5
Fort Madison|IA|US|40.63|-91.32
Bolivar|MO|US|37.61|-93.41
Bastrop|LA|US|32.78|-91.91
Atchison|KS|US|39.56|-95.12
Largo|MD|US|38.89|-76.84
Fredonia|NY|US|42.44|-79.33
Cheval|FL|US|28.15|-82.51
Halfway|MD|US|39.62|-77.76
Petal|MS|US|31.35|-89.26
Kapa'a|HI|US|22.08|-159.32
Rosaryville|MD|US|38.76|-76.81
Somers Point|NJ|US|39.32|-74.59
Little Falls|NJ|US|40.87|-74.21
Germantown|PA|US|40.04|-75.18
Darby|PA|US|39.92|-75.26
Mariehamn|Mariehamn|AX|60.1|19.93
Vidalia|GA|US|32.22|-82.41
Gonzales|LA|US|30.24|-90.92
Grimes|IA|US|41.69|-93.79
Picayune|MS|US|30.53|-89.68
Klahanie|WA|US|47.57|-122.01
Kaka'ako|HI|US|21.3|-157.86
Batesville|AR|US|35.77|-91.64
Northbrook|OH|US|39.25|-84.58
Kennett|MO|US|36.24|-90.06
Burlington|WI|US|42.68|-88.28
Placerville|CA|US|38.73|-120.8
Garden Acres|CA|US|37.96|-121.23
Muscoy|CA|US|34.15|-117.34
Sandy|OR|US|45.4|-122.26
Lansdowne|PA|US|39.94|-75.27
Morro Bay|CA|US|35.37|-120.85
Satellite Beach|FL|US|28.18|-80.59
Scottdale|GA|US|33.79|-84.26
Massena|NY|US|44.93|-74.89
Old Saybrook|CT|US|41.29|-72.38
Bedford Heights|OH|US|41.42|-81.53
Vashon|WA|US|47.45|-122.46
Kralendijk|Bonaire|BQ|12.15|-68.27
Camp Pendleton South|CA|US|33.23|-117.38
Forest Acres|SC|US|34.02|-80.99
Winton|CA|US|37.39|-120.61
Keokuk|IA|US|40.4|-91.38
West Perrine|FL|US|25.61|-80.36
Eureka|MO|US|38.5|-90.63
Norwell|MA|US|42.16|-70.79
Gardere|LA|US|30.35|-91.14
Accokeek|MD|US|38.67|-77.03
Union City|TN|US|36.42|-89.06
Vernon|TX|US|34.16|-99.27
Vienna|WV|US|39.33|-81.55
Eltingville|NY|US|40.55|-74.17
Santaquin|UT|US|39.98|-111.79
North Versailles|PA|US|40.38|-79.81
Lawrenceburg|TN|US|35.24|-87.33
Roscoe|IL|US|42.41|-89.01
Hillsdale|NJ|US|41|-74.04
Exeter|CA|US|36.3|-119.14
Belmont|NC|US|35.24|-81.04
Forestville|OH|US|39.08|-84.34
Weddington|NC|US|35.02|-80.76
Farmington|MI|US|42.46|-83.38
Jackson|WY|US|43.48|-110.76
Chesapeake Ranch Estates|MD|US|38.35|-76.42
Fox Lake|IL|US|42.4|-88.18
Manchester|TN|US|35.48|-86.09
The Pinery|CO|US|39.46|-104.73
Pine Hill|NJ|US|39.78|-74.99
Montgomery|OH|US|39.23|-84.35
Redwood Shores|CA|US|37.53|-122.25
Sebring|FL|US|27.5|-81.44
Dent|OH|US|39.19|-84.65
Bound Brook|NJ|US|40.57|-74.54
Sauk Village|IL|US|41.49|-87.57
Rockport|TX|US|28.02|-97.06
Heath|OH|US|40.02|-82.44
Ventnor City|NJ|US|39.34|-74.48
Middle Island|NY|US|40.88|-72.94
Arizona City|AZ|US|32.76|-111.67
Richmond Heights|OH|US|41.55|-81.51
Wyomissing|PA|US|40.33|-75.97
Burley|ID|US|42.54|-113.79
Vermilion|OH|US|41.42|-82.36
Key Largo|FL|US|25.09|-80.45
Warr Acres|OK|US|35.52|-97.62
Canandaigua|NY|US|42.87|-77.29
Manville|NJ|US|40.54|-74.59
West Haverstraw|NY|US|41.21|-73.99
Lincoln Park|NJ|US|40.92|-74.3
Melvindale|MI|US|42.28|-83.18
Cambridge|OH|US|40.03|-81.59
Greencastle|IN|US|39.64|-86.86
Big Rapids|MI|US|43.7|-85.48
Kinnelon|NJ|US|41|-74.37
Palatka|FL|US|29.65|-81.64
Columbia|PA|US|40.03|-76.5
Sedona|AZ|US|34.87|-111.76
Celina|OH|US|40.55|-84.57
Norfolk|MA|US|42.12|-71.33
Portage|WI|US|43.54|-89.46
Wabash|IN|US|40.8|-85.82
Struthers|OH|US|41.05|-80.61
Cadillac|MI|US|44.25|-85.4
Fairview|TX|US|33.16|-96.63
Big Lake|MN|US|45.33|-93.75
Pella|IA|US|41.41|-92.92
Castle Pines North|CO|US|39.47|-104.89
Mount Airy|NC|US|36.5|-80.61
Barrington|IL|US|42.15|-88.14
Durham|NH|US|43.13|-70.93
West Point|UT|US|41.12|-112.08
Silver Springs|FL|US|29.22|-82.06
Newberry|SC|US|34.27|-81.62
Linthicum|MD|US|39.21|-76.65
Reading|OH|US|39.22|-84.44
Bluefield|WV|US|37.27|-81.22
Little Canada|MN|US|45.03|-93.09
Eunice|LA|US|30.49|-92.42
Wood River|IL|US|38.86|-90.1
Hull|MA|US|42.3|-70.91
Oak Grove|SC|US|33.98|-81.14
Morris Park|NY|US|40.85|-73.85
Benning Road|DC|US|38.89|-76.94
Newport|OR|US|44.64|-124.05
Beverly Hills|MI|US|42.52|-83.22
Edwards|CO|US|39.64|-106.59
Cedar Hills|UT|US|40.41|-111.76
Pleasant Grove|AL|US|33.49|-86.97
Lancaster|NY|US|42.9|-78.67
Nanticoke|PA|US|41.21|-76
Milford|DE|US|38.91|-75.43
Rossmoor|CA|US|33.79|-118.09
Timberlane|LA|US|29.88|-90.03
Sleepy Hollow|NY|US|41.09|-73.86
Fairview Shores|FL|US|28.59|-81.39
Waterloo|IL|US|38.34|-90.15
Alpine|UT|US|40.45|-111.78
Beecher|MI|US|43.09|-83.69
Fairmount|NY|US|43.05|-76.24
Espanola|NM|US|35.99|-106.08
Berwick|PA|US|41.05|-76.23
Roma|TX|US|26.41|-99.02
Fairmont|MN|US|43.65|-94.46
River Grove|IL|US|41.93|-87.84
Anderson|CA|US|40.45|-122.3
North Branch|MN|US|45.51|-92.98
Watervliet|NY|US|42.73|-73.7
Hanson|MA|US|42.08|-70.88
Vail|AZ|US|32.05|-110.71
Hillcrest|DC|US|38.86|-76.96
Gages Lake|IL|US|42.35|-87.98
Jefferson|GA|US|34.12|-83.57
Raceland|LA|US|29.73|-90.6
Columbia|IL|US|38.44|-90.2
Bel Air|MD|US|39.54|-76.35
Capitola|CA|US|36.98|-121.95
North Logan|UT|US|41.77|-111.8
Jennings|LA|US|30.22|-92.66
Bohemia|NY|US|40.77|-73.12
Alpena|MI|US|45.06|-83.43
Bellmead|TX|US|31.59|-97.11
Forestdale|AL|US|33.57|-86.9
Wells Beach Station|ME|US|43.32|-70.59
Lake Morton-Berrydale|WA|US|47.33|-122.1
Gold Camp|AZ|US|33.29|-111.3
Shasta Lake|CA|US|40.68|-122.37
Gold Canyon|AZ|US|33.37|-111.44
Lanham|MD|US|38.97|-76.86
Paris|TN|US|36.3|-88.33
Great Neck|NY|US|40.8|-73.73
Colts Neck|NJ|US|40.29|-74.17
East Stroudsburg|PA|US|41|-75.18
Oil City|PA|US|41.43|-79.71
Norwalk|IA|US|41.48|-93.68
Marlton|NJ|US|39.89|-74.92
North End|MA|US|42.37|-71.05
Galion|OH|US|40.73|-82.79
Denham Springs|LA|US|30.49|-90.96
Fort Knox|KY|US|37.89|-85.96
Essex Junction|VT|US|44.49|-73.11
San Diego Country Estates|CA|US|33.01|-116.78
Maynard|MA|US|42.43|-71.45
Waldwick|NJ|US|41.01|-74.12
Port Salerno|FL|US|27.14|-80.2
Parsons|KS|US|37.34|-95.26
Comstock Park|MI|US|43.04|-85.67
Avon Park|FL|US|27.6|-81.51
Inwood|NY|US|40.87|-73.93
Mayfield|KY|US|36.74|-88.64
Bonham|TX|US|33.58|-96.18
Lexington|NE|US|40.78|-99.74
Countryside|VA|US|39.04|-77.41
Waverly|IA|US|42.73|-92.48
Canyon Rim|UT|US|40.71|-111.82
London|OH|US|39.89|-83.45
North Andrews Gardens|FL|US|26.19|-80.14
Clinton|TN|US|36.1|-84.13
Atmore|AL|US|31.02|-87.49
Little Neck|NY|US|40.76|-73.73
Oregon|WI|US|42.93|-89.38
Poulsbo|WA|US|47.74|-122.65
Troy|IL|US|38.73|-89.88
New Port Richey East|FL|US|28.26|-82.69
Plymouth|IN|US|41.34|-86.31
Monmouth|OR|US|44.85|-123.23
Grantsville|UT|US|40.6|-112.46
Elon|NC|US|36.1|-79.51
Woodbury|NJ|US|39.84|-75.15
Oak Creek|CA|US|33.67|-117.77
Waggaman|LA|US|29.92|-90.21
Fort Salonga|NY|US|40.91|-73.3
Bluffton|IN|US|40.74|-85.17
Silver City|NM|US|32.77|-108.28
Fairview|CA|US|37.68|-122.05
Del Aire|CA|US|33.92|-118.37
Cross Lanes|WV|US|38.42|-81.79
Huguenot|NY|US|40.54|-74.19
Veradale|WA|US|47.65|-117.21
Uniontown|PA|US|39.9|-79.72
Harrisonville|MO|US|38.65|-94.35
Pearsall|TX|US|28.89|-99.1
Dishman|WA|US|47.66|-117.28
Newton Highlands|MA|US|42.32|-71.2
Benton Harbor|MI|US|42.12|-86.45
Fife|WA|US|47.24|-122.36
Cottage Grove|OR|US|43.8|-123.06
Carroll|IA|US|42.07|-94.87
Lambertville|MI|US|41.77|-83.63
Peru|IL|US|41.33|-89.13
Arden Hills|MN|US|45.05|-93.16
Croydon|PA|US|40.09|-74.9
Indianola|MS|US|33.45|-90.66
East Oak Lane|PA|US|40.05|-75.13
Spruce Hill|PA|US|39.95|-75.21
Covington|LA|US|30.48|-90.1
Kendallville|IN|US|41.44|-85.26
Timonium|MD|US|39.44|-76.62
Lake Monticello|VA|US|37.92|-78.33
Lackland Air Force Base|TX|US|29.39|-98.62
Lake Mohawk|NJ|US|41.02|-74.66
Flat Rock|MI|US|42.1|-83.29
Cape Canaveral|FL|US|28.41|-80.6
Glenwood Springs|CO|US|39.55|-107.32
Corte Madera|CA|US|37.93|-122.53
Tipp City|OH|US|39.96|-84.17
Pennypack|PA|US|40.07|-75.05
Harrison|OH|US|39.26|-84.82
Warrenton|VA|US|38.71|-77.8
Deanwood|DC|US|38.9|-76.93
Coral Hills|MD|US|38.87|-76.92
Elkhorn|WI|US|42.67|-88.54
East Rockaway|NY|US|40.64|-73.67
Fairfield|IA|US|41.01|-91.96
Hope|AR|US|33.67|-93.59
Bloomingdale|TN|US|36.58|-82.49
New Albany|OH|US|40.08|-82.81
Andover|FL|US|25.97|-80.21
Brownsville|TN|US|35.59|-89.26
Fort Lee|VA|US|37.25|-77.33
Moncks Corner|SC|US|33.2|-80.01
Keansburg|NJ|US|40.44|-74.13
Paris|KY|US|38.21|-84.25
Kendall Square|MA|US|42.37|-71.09
Northampton|PA|US|40.69|-75.5
Middleton|MA|US|42.6|-71.02
Woodley Park|DC|US|38.93|-77.06
Brandon|SD|US|43.59|-96.57
Highland|IL|US|38.74|-89.67
Russellville|AL|US|34.51|-87.73
Fate|TX|US|32.94|-96.38
Brambleton|VA|US|38.98|-77.54
Rincon|GA|US|32.3|-81.24
Cameron|MO|US|39.74|-94.24
Havre|MT|US|48.55|-109.68
Shelton|WA|US|47.22|-123.1
Christiana|TN|US|35.71|-86.4
Pleasanton|TX|US|28.97|-98.48
Edgewood|WA|US|47.25|-122.29
Wapakoneta|OH|US|40.57|-84.19
Monticello|AR|US|33.63|-91.79
Alamosa|CO|US|37.47|-105.87
New Hyde Park|NY|US|40.74|-73.69
Waynesville|NC|US|35.49|-82.99
Burlington|NJ|US|40.07|-74.86
Maywood|NJ|US|40.9|-74.06
Fort Oglethorpe|GA|US|34.95|-85.26
Cody|WY|US|44.53|-109.06
Cleveland Park|DC|US|38.94|-77.07
Walnut Grove|WA|US|45.67|-122.6
Washington|NC|US|35.55|-77.05
Wyndham|VA|US|37.7|-77.61
Hartford|VT|US|43.66|-72.34
Lake Arbor|MD|US|38.91|-76.83
Ballston Lake|NY|US|42.91|-73.87
Merrydale|LA|US|30.5|-91.11
Minnehaha|WA|US|45.66|-122.63
Reserve|LA|US|30.05|-90.55
Union Park|FL|US|28.57|-81.29
Roma-Los Saenz|TX|US|26.41|-99.02
Progress|PA|US|40.29|-76.83
Le Mars|IA|US|42.79|-96.17
Alachua|FL|US|29.75|-82.42
Marysville|MI|US|42.91|-82.49
East La Mirada|CA|US|33.92|-117.99
Woodbury|CT|US|41.54|-73.21
Silverton|OR|US|45.01|-122.78
Cairo|GA|US|30.88|-84.2
Baker City|OR|US|44.77|-117.83
Cedartown|GA|US|34.01|-85.26
Panthersville|GA|US|33.71|-84.27
Brownfield|TX|US|33.18|-102.27
Vinings|GA|US|33.86|-84.46
Otis|IN|US|41.6|-86.91
Dunn|NC|US|35.31|-78.61
Chestnut Hill|PA|US|40.08|-75.21
Hermantown|MN|US|46.81|-92.24
Sumner|WA|US|47.2|-122.24
Ingleside|TX|US|27.88|-97.21
Boaz|AL|US|34.2|-86.17
Potsdam|NY|US|44.67|-74.98
Southborough|MA|US|42.31|-71.52
Safford|AZ|US|32.83|-109.71
Sparta|WI|US|43.94|-90.81
Mountain House|CA|US|37.78|-121.54
North Bend|OR|US|43.41|-124.22
Snohomish|WA|US|47.91|-122.1
Coffeyville|KS|US|37.04|-95.62
Park Forest Village|PA|US|40.81|-77.92
Winfield|IL|US|41.86|-88.16
Hampton|NH|US|42.94|-70.84
Clay|AL|US|33.7|-86.6
Sunbury|PA|US|40.86|-76.79
Holmen|WI|US|43.96|-91.26
Westview|FL|US|25.88|-80.24
Hamilton Hills|MD|US|39.36|-76.57
Edgemere|NY|US|40.6|-73.77
Soquel|CA|US|36.99|-121.96
Kalaoa|HI|US|19.73|-155.98
Bellevue|DC|US|38.83|-77.01
Bladensburg|MD|US|38.94|-76.93
Jesup|GA|US|31.61|-81.89
East Falls|PA|US|40.01|-75.19
Milton|FL|US|30.63|-87.04
Astoria|OR|US|46.19|-123.83
Mooresville|IN|US|39.61|-86.37
Red Bank|SC|US|33.93|-81.24
Danville|IN|US|39.76|-86.53
Rye Brook|NY|US|41.02|-73.68
Cypress Village|CA|US|33.69|-117.76
La Salle|IL|US|41.33|-89.09
Tega Cay|SC|US|35.02|-81.03
Lock Haven|PA|US|41.14|-77.45
Nonantum|MA|US|42.36|-71.2
Winslow|AZ|US|35.02|-110.7
Rosslyn|VA|US|38.9|-77.07
Girard|OH|US|41.15|-80.7
Bee Ridge|FL|US|27.28|-82.48
Pine Ridge|FL|US|28.94|-82.47
Orange Cove|CA|US|36.62|-119.31
Gifford|FL|US|27.68|-80.41
Rainbow City|AL|US|33.95|-86.04
Hackettstown|NJ|US|40.85|-74.83
Morrell Park|PA|US|40.07|-74.99
Hamburg|NY|US|42.72|-78.83
Bristol|PA|US|40.1|-74.85
Clinton|OK|US|35.52|-98.97
Picture Rocks|AZ|US|32.35|-111.25
Rifle|CO|US|39.53|-107.78
Chuckey|TN|US|36.22|-82.69
Coweta|OK|US|35.95|-95.65
Lake Barcroft|VA|US|38.85|-77.16
Brock Hall|MD|US|38.85|-76.76
Brooklyn|MD|US|39.23|-76.6
Bethel|CT|US|41.37|-73.41
Reedsburg|WI|US|43.53|-90
Chevy Chase|DC|US|38.98|-77.08
Chevy Chase|MD|US|39|-77.07
Prineville|OR|US|44.3|-120.83
Dongan Hills|NY|US|40.59|-74.1
Howell|MI|US|42.61|-83.93
Clifton|NY|US|40.62|-74.08
Pecos|TX|US|31.42|-103.49
Marine Corps Base Hawaii - MCBH|HI|US|21.44|-157.75
Steger|IL|US|41.47|-87.64
North Kensington|MD|US|39.04|-77.07
White Marsh|MD|US|39.38|-76.43
Sugar Grove|IL|US|41.76|-88.44
North Gates|NY|US|43.18|-77.7
Brentwood|PA|US|40.37|-79.97
Fort George G Mead Junction|MD|US|39.13|-76.79
River Vale|NJ|US|41|-74.01
Taft|CA|US|35.14|-119.46
White Horse|NJ|US|40.19|-74.7
Mission|KS|US|39.03|-94.66
Ma'ili|HI|US|21.42|-158.18
Chillicothe|MO|US|39.8|-93.55
Amityville|NY|US|40.68|-73.42
Woodlyn|PA|US|39.87|-75.34
Villas|NJ|US|39.03|-74.94
Flossmoor|IL|US|41.54|-87.68
Braselton|GA|US|34.11|-83.76
Prospect|CT|US|41.5|-72.98
Orono|ME|US|44.88|-68.67
Pryor Creek|OK|US|36.31|-95.32
Decatur|IN|US|40.83|-84.93
Valley|AL|US|32.82|-85.18
Winterville|NC|US|35.53|-77.4
Moanalua|HI|US|21.37|-157.89
Somers|WI|US|42.64|-87.91
Lowell|IN|US|41.29|-87.42
Southwick|MA|US|42.05|-72.77
Springfield|FL|US|30.15|-85.61
Newcastle|OK|US|35.25|-97.6
Marlboro Village|MD|US|38.83|-76.77
Clarksville|AR|US|35.47|-93.47
Rensselaer|NY|US|42.64|-73.74
Lamesa|TX|US|32.74|-101.95
Kearney|MO|US|39.37|-94.36
South Huntington|NY|US|40.82|-73.4
Anaconda|MT|US|46.13|-112.94
Gloucester Point|VA|US|37.25|-76.5
The Village|OK|US|35.56|-97.55
Lisbon|ME|US|44.03|-70.1
Granbury|TX|US|32.44|-97.79
Willoughby Hills|OH|US|41.6|-81.42
Mount Airy|MD|US|39.38|-77.15
Country Club|CA|US|37.97|-121.34
Berlin|NH|US|44.47|-71.19
Saint Francis|WI|US|42.97|-87.88
Makaha-Ka'ena|HI|US|21.48|-158.23
North Bath|ME|US|43.93|-69.82
Economy|PA|US|40.6|-80.22
Lake Hiawatha|NJ|US|40.88|-74.38
Thompson|CT|US|41.96|-71.86
Tomah|WI|US|43.98|-90.5
DuPont|WA|US|47.1|-122.63
Woodbridge|CT|US|41.35|-73.01
Valencia West|AZ|US|32.13|-111.11
Blackhawk|CA|US|37.82|-121.91
Harahan|LA|US|29.94|-90.2
Bethalto|IL|US|38.91|-90.04
Morehead City|NC|US|34.72|-76.73
West Newton|MA|US|42.35|-71.23
Saint Pete Beach|FL|US|27.73|-82.74
Kendall Park|NJ|US|40.42|-74.56
'Aiea|HI|US|21.38|-157.93
Mound|MN|US|44.94|-93.67
Jeannette|PA|US|40.33|-79.62
Port Townsend|WA|US|48.12|-122.76
Warren|PA|US|41.84|-79.15
North College Hill|OH|US|39.22|-84.55
Fort Meade|MD|US|39.11|-76.74
Greenwood|AR|US|35.22|-94.26
Alcoa|TN|US|35.79|-83.97
Rockcreek|OR|US|45.55|-122.88
Pleasant Hill|IA|US|41.58|-93.52
Charter Oak|CA|US|34.1|-117.85
Rochelle|IL|US|41.92|-89.07
Beacon Hill|MA|US|42.36|-71.07
Woodfield|SC|US|34.06|-80.93
Augusta|KS|US|37.69|-96.98
Bala Cynwyd|PA|US|40.01|-75.23
Hebron|CT|US|41.66|-72.37
Anthony|NM|US|32|-106.61
Brewerytown|PA|US|39.98|-75.18
Monmouth|IL|US|40.91|-90.65
Box Elder|SD|US|44.11|-103.07
Harleysville|PA|US|40.28|-75.39
Ellisville|MO|US|38.59|-90.59
Wasilla|AK|US|61.58|-149.44
Lynwood|IL|US|41.53|-87.54
Fairview|OR|US|45.54|-122.43
Valley Center|CA|US|33.22|-117.03
Frankfort Square|IL|US|41.52|-87.8
Pleasant View|UT|US|41.32|-111.99
Sweet Home|OR|US|44.4|-122.74
Gunbarrel|CO|US|40.06|-105.17
Bay Saint Louis|MS|US|30.31|-89.33
Ecorse|MI|US|42.24|-83.15
Seven Corners|VA|US|38.87|-77.16
Chanute|KS|US|37.68|-95.46
Perryton|TX|US|36.4|-100.8
Friendly|MD|US|38.75|-76.98
Fairmount|PA|US|39.97|-75.18
Tulalip|WA|US|48.07|-122.29
Haiku-Pauwela|HI|US|20.92|-156.31
Belmont|MI|US|43.08|-85.61
Exeter|NH|US|42.98|-70.95
Waseca|MN|US|44.08|-93.51
Brookdale|NJ|US|40.83|-74.18
Grants|NM|US|35.15|-107.85
Stuarts Draft|VA|US|38.03|-79.03
Smithville|MO|US|39.39|-94.58
Merrill|WI|US|45.18|-89.68
Purcellville|VA|US|39.14|-77.71
Brewer|ME|US|44.8|-68.76
Grosse Pointe Farms|MI|US|42.41|-82.89
Mapleton|UT|US|40.13|-111.58
Independence|OR|US|44.85|-123.19
Lititz|PA|US|40.16|-76.31
Groton|CT|US|41.35|-72.08
Rockingham|NC|US|34.94|-79.77
Leonia|NJ|US|40.86|-73.99
Hartland|WI|US|43.11|-88.34
Rio Del Mar|CA|US|36.97|-121.9
Sutton|MA|US|42.15|-71.76
Tiburon|CA|US|37.87|-122.46
Scotchtown|NY|US|41.48|-74.36
Waimea|HI|US|20.02|-155.67
Garden City|SC|US|33.59|-79.01
Brigantine|NJ|US|39.41|-74.36
Heber City|UT|US|40.51|-111.41
Aliquippa|PA|US|40.64|-80.24
Larchmont|CA|US|34.08|-118.32
Harvard|IL|US|42.42|-88.61
Alma|MI|US|43.38|-84.66
Good Hope|CA|US|33.76|-117.27
Centerville|MA|US|41.65|-70.35
Highland Park|TX|US|32.83|-96.79
Beckett Ridge|OH|US|39.35|-84.44
Saint Dennis|KY|US|38.19|-85.85
Urbana|MD|US|39.33|-77.35
Riverdale|NY|US|40.9|-73.91
Presque Isle|ME|US|46.68|-68.02
Laurens|SC|US|34.5|-82.01
East Rutherford|NJ|US|40.83|-74.1
Blackstone|MA|US|42.02|-71.54
Madera Acres|CA|US|37.02|-120.07
Washington Terrace|UT|US|41.17|-111.98
Succasunna|NJ|US|40.87|-74.64
Versailles|KY|US|38.05|-84.73
Grinnell|IA|US|41.74|-92.72
Shawano|WI|US|44.78|-88.61
Louisville|OH|US|40.84|-81.26
Riggs Park|DC|US|38.95|-76.99
La Plata|MD|US|38.53|-76.98
Hondo|TX|US|29.35|-99.14
Bay Minette|AL|US|30.88|-87.77
Middletown|PA|US|40.2|-76.73
Sheffield|AL|US|34.77|-87.7
Selma|TX|US|29.58|-98.31
Valley Cottage|NY|US|41.12|-73.96
Forest|VA|US|37.36|-79.29
Marianna|FL|US|30.77|-85.23
Saline|MI|US|42.17|-83.78
Roxborough Park|CO|US|39.47|-105.09
Lenoir City|TN|US|35.8|-84.26
Rock Falls|IL|US|41.78|-89.69
Portola Hills|CA|US|33.68|-117.63
Bennington|VT|US|42.88|-73.2
Berkeley|MO|US|38.75|-90.33
Atoka|TN|US|35.44|-89.78
Andalusia|AL|US|31.31|-86.48
Georgetown|SC|US|33.38|-79.29
College Place|WA|US|46.05|-118.39
Shelby|OH|US|40.88|-82.66
Stuttgart|AR|US|34.5|-91.55
Hernando|FL|US|28.9|-82.37
Charlotte|MI|US|42.56|-84.84
Lake Hopatcong|NJ|US|40.95|-74.62
Micco|FL|US|27.88|-80.5
Oakwood|OH|US|39.73|-84.17
Winston|FL|US|28.03|-82.01
Fultondale|AL|US|33.6|-86.79
Oakville|CT|US|41.59|-73.09
Lake Lucerne|FL|US|25.97|-80.24
East Haddam|CT|US|41.45|-72.46
Rawlins|WY|US|41.79|-107.24
Elgin|TX|US|30.35|-97.37
Liberty|TX|US|30.06|-94.8
Evergreen|CO|US|39.63|-105.32
Fort Polk South|LA|US|31.05|-93.22
Oakbrook|KY|US|39|-84.69
Covington|TN|US|35.56|-89.65
Thomaston|GA|US|32.89|-84.33
Lincoln Village|OH|US|39.95|-83.13
Marlton|MD|US|38.77|-76.79
Sheffield Lake|OH|US|41.49|-82.1
Edgewater|MD|US|38.94|-76.56
Scott|LA|US|30.24|-92.09
Fitzgerald|GA|US|31.71|-83.25
Alexandria|KY|US|38.96|-84.39
Olney|IL|US|38.73|-88.09
Detroit Lakes|MN|US|46.82|-95.85
Garden City|GA|US|32.11|-81.15
Manteno|IL|US|41.25|-87.83
Mechanicsburg|PA|US|40.21|-77.01
San Elizario|TX|US|31.59|-106.27
Glenwood|IL|US|41.54|-87.6
Toppenish|WA|US|46.38|-120.31
Chatham|NJ|US|40.74|-74.38
Monett|MO|US|36.93|-93.93
Glenshaw|PA|US|40.53|-79.97
Benning|DC|US|38.9|-76.95
Madeira|OH|US|39.19|-84.36
Molalla|OR|US|45.15|-122.58
Clarendon Hills|MA|US|42.28|-71.12
Budd Lake|NJ|US|40.87|-74.73
Montecito|CA|US|34.44|-119.63
Dayton|NV|US|39.24|-119.59
Stonegate|CO|US|39.53|-104.8
Midland|WA|US|47.17|-122.4
Little River|SC|US|33.87|-78.61
Eidson Road|TX|US|28.68|-100.49
Independence|KS|US|37.22|-95.71
Fallston|MD|US|39.51|-76.41
Lancaster|SC|US|34.72|-80.77
Sturgeon Bay|WI|US|44.83|-87.38
Northwest Harborcreek|PA|US|42.15|-79.99
Glencoe|IL|US|42.14|-87.76
Princeton|TX|US|33.18|-96.5
DeForest|WI|US|43.25|-89.34
Westerleigh|NY|US|40.62|-74.13
New Windsor|NY|US|41.48|-74.02
Canonsburg|PA|US|40.26|-80.19
Park Ridge|NJ|US|41.04|-74.04
Cypress Gardens|FL|US|27.99|-81.69
Bristow|VA|US|38.72|-77.54
Liberty Lake|WA|US|47.68|-117.12
Plymouth|MI|US|42.37|-83.47
Eagle Point|OR|US|42.47|-122.8
Clinton|MO|US|38.37|-93.78
Pitman|NJ|US|39.73|-75.13
Bayport|NY|US|40.74|-73.05
Medulla|FL|US|27.97|-81.97
Commerce|TX|US|33.25|-95.9
Harrisburg|IL|US|37.74|-88.54
Airmont|NY|US|41.1|-74.12
Pulaski|VA|US|37.05|-80.78
Olmsted Falls|OH|US|41.38|-81.91
Larkfield-Wikiup|CA|US|38.51|-122.75
Oak Hills|CA|US|34.38|-117.38
Myrtle Grove|NC|US|34.13|-77.88
Marina del Rey|CA|US|33.98|-118.45
Graham|TX|US|33.11|-98.59
Sitka|AK|US|57.05|-135.33
Lincoln Heights|DC|US|38.89|-76.93
Columbia City|IN|US|41.16|-85.49
Concord|NY|US|40.61|-74.08
East Wenatchee Bench|WA|US|47.43|-120.28
Quakertown|PA|US|40.44|-75.34
Swissvale|PA|US|40.42|-79.88
Matawan|NJ|US|40.41|-74.23
South Amboy|NJ|US|40.48|-74.29
Fort Irwin|CA|US|35.26|-116.68
Clanton|AL|US|32.84|-86.63
Craig|CO|US|40.52|-107.55
Newark|NY|US|43.05|-77.1
Bernalillo|NM|US|35.3|-106.55
Isle of Normandy|FL|US|25.85|-80.14
Lake Wylie|SC|US|35.11|-81.04
Waihee-Waiehu|HI|US|20.93|-156.5
White Meadow Lake|NJ|US|40.92|-74.51
Riverside|IL|US|41.84|-87.82
Milford|NH|US|42.84|-71.65
Conning Towers-Nautilus Park|CT|US|41.39|-72.07
New Albany|MS|US|34.49|-89.01
Waterford|CA|US|37.64|-120.76
Garrison|MD|US|39.41|-76.76
Jeffries Point|MA|US|42.37|-71.03
Whippany|NJ|US|40.82|-74.42
Lake Villa|IL|US|42.42|-88.07
New Richmond|WI|US|45.12|-92.54
Maysville|KY|US|38.64|-83.74
Tuskegee|AL|US|32.42|-85.69
Plainedge|NY|US|40.72|-73.48
Booneville|MS|US|34.66|-88.57
Cresskill|NJ|US|40.94|-73.96
Cloverdale|CA|US|38.81|-123.02
'Ahuimanu|HI|US|21.44|-157.84
Picnic Point|WA|US|47.88|-122.33
Dunn Loring|VA|US|38.89|-77.22
Itasca|IL|US|41.98|-88.01
Miles City|MT|US|46.41|-105.84
Collingdale|PA|US|39.91|-75.28
Delta|CO|US|38.74|-108.07
Lapeer|MI|US|43.05|-83.32
Franklin|KY|US|36.72|-86.58
Columbus|NJ|US|40.07|-74.72
East York|PA|US|39.97|-76.69
Woodway|TX|US|31.51|-97.21
Incline Village|NV|US|39.25|-119.97
Orosi|CA|US|36.54|-119.29
Meadowbrook|AL|US|33.4|-86.7
Edgewood|KY|US|39.02|-84.58
Clinton|NC|US|35|-78.32
Andover|MA|US|42.66|-71.14
Rotonda West|FL|US|26.88|-82.29
Saint Stephens|NC|US|35.76|-81.27
Fuller Heights|FL|US|27.91|-82
Gig Harbor|WA|US|47.33|-122.58
Thief River Falls|MN|US|48.12|-96.18
Marathon|FL|US|24.71|-81.09
Leisure World|MD|US|39.1|-77.07
Cape Saint Claire|MD|US|39.04|-76.44
Barre|VT|US|44.2|-72.5
Anderson Mill|TX|US|30.45|-97.81
Oxford|NC|US|36.31|-78.59
Woodmoor|CO|US|39.1|-104.85
Poteau|OK|US|35.05|-94.62
Audubon|NJ|US|39.89|-75.07
West Athens|CA|US|33.92|-118.3
Wharton|TX|US|29.31|-96.1
Socorro|NM|US|34.06|-106.89
Mentone|CA|US|34.07|-117.13
Cortez|CO|US|37.35|-108.59
Wagoner|OK|US|35.96|-95.37
Moundsville|WV|US|39.92|-80.74
Pryor|OK|US|36.31|-95.32
Pine Lake Park|NJ|US|40|-74.26
Flowood|MS|US|32.31|-90.14
Orange Park|FL|US|30.17|-81.71
Kennedy Township|PA|US|40.48|-80.1
Asbury Lake|FL|US|30.05|-81.82
Milton|WA|US|47.25|-122.31
Ha'iku|HI|US|20.92|-156.32
Park Hills|MO|US|37.85|-90.52
Murphy|MO|US|38.49|-90.49
Farmingdale|NY|US|40.73|-73.45
Redlands|CO|US|39.08|-108.64
Blacklick Estates|OH|US|39.91|-82.86
Lacombe|LA|US|30.31|-89.94
Seabrook|NH|US|42.89|-70.87
Rodeo|CA|US|38.03|-122.27
Clarendon Hills|IL|US|41.8|-87.95
Victoria|MN|US|44.86|-93.66
Edgemere|MD|US|39.24|-76.45
East Franklin|NJ|US|40.49|-74.47
Frostburg|MD|US|39.66|-78.93
Southwest Schuylkill|PA|US|39.94|-75.2
Riverdale|UT|US|41.18|-112
Closter|NJ|US|40.97|-73.96
Beaver Falls|PA|US|40.75|-80.32
Sellersburg|IN|US|38.4|-85.75
Greenville|RI|US|41.87|-71.55
Golden Hills|CA|US|35.14|-118.49
Cedar Park|PA|US|39.95|-75.23
Westwood|MI|US|42.3|-85.63
Hampstead|NH|US|42.87|-71.18
Little Falls|MN|US|45.98|-94.36
Fort Stockton|TX|US|30.89|-102.88
Florence|OR|US|43.98|-124.1
Angola|IN|US|41.63|-85
Irvine Health and Science Complex|CA|US|33.66|-117.77
East Grand Forks|MN|US|47.93|-97.02
Clinton|SC|US|34.47|-81.88
Montague|MA|US|42.54|-72.54
Hanover|NH|US|43.7|-72.29
Harwood Heights|IL|US|41.97|-87.81
Burlington|WA|US|48.48|-122.33
Monroe|NY|US|41.33|-74.19
Princeton|IN|US|38.36|-87.57
Old Orchard Beach|ME|US|43.52|-70.38
Citrus Springs|FL|US|29|-82.47
La Grange|KY|US|38.41|-85.38
Bacliff|TX|US|29.51|-94.99
Willowbrook|IL|US|41.77|-87.94
Palm Beach|FL|US|26.71|-80.04
Tuba City|AZ|US|36.13|-111.24
Port Jervis|NY|US|41.38|-74.69
Bennettsville|SC|US|34.62|-79.68
Morrisville|PA|US|40.21|-74.79
Fort Valley|GA|US|32.55|-83.89
Ladue|MO|US|38.65|-90.38
Sallisaw|OK|US|35.46|-94.79
Napoleon|OH|US|41.39|-84.13
Alondra Park|CA|US|33.89|-118.33
Helotes|TX|US|29.58|-98.69
Fort Bliss|TX|US|31.81|-106.41
Chester|IL|US|37.91|-89.82
Virginia|MN|US|47.52|-92.54
Weare|NH|US|43.09|-71.73
Thompsonville|CT|US|42|-72.6
Mecca|CA|US|33.57|-116.08
Carencro|LA|US|30.32|-92.05
Southside|AL|US|33.92|-86.02
Des Peres|MO|US|38.6|-90.43
Malverne|NY|US|40.68|-73.67
Bonadelle Ranchos-Madera Ranchos|CA|US|36.98|-119.87
Carbondale|PA|US|41.57|-75.5
Kirby|TX|US|29.46|-98.39
Lowell|AR|US|36.26|-94.13
North Haledon|NJ|US|40.96|-74.19
North Madison|OH|US|41.83|-81.06
Country Club Estates|GA|US|31.21|-81.46
Cold Springs|NV|US|39.68|-119.98
Linganore|MD|US|39.41|-77.3
Westwego|LA|US|29.91|-90.14
Calimesa|CA|US|34|-117.06
Richmond Heights|FL|US|25.63|-80.37
Sunset Hills|MO|US|38.54|-90.41
Winchester|TN|US|35.19|-86.11
Lake Park|FL|US|26.8|-80.07
Holualoa|HI|US|19.62|-155.95
Earlimart|CA|US|35.88|-119.27
Elsmere|KY|US|39.01|-84.6
Lincoln City|OR|US|44.96|-124.02
Aransas Pass|TX|US|27.91|-97.15
Signal Mountain|TN|US|35.12|-85.34
North Weeki Wachee|FL|US|28.55|-82.56
Alliance|NE|US|42.1|-102.87
Northfield|NJ|US|39.37|-74.55
Temperance|MI|US|41.78|-83.57
Bradford|PA|US|41.96|-78.64
Westlake Village|CA|US|34.15|-118.81
Monson|MA|US|42.1|-72.32
Plymouth|WI|US|43.75|-87.98
Jefferson City|TN|US|36.12|-83.49
Corrales|NM|US|35.24|-106.61
Clayton|NJ|US|39.66|-75.09
Mystic Island|NJ|US|39.54|-74.38
Orrville|OH|US|40.84|-81.76
Franklin|VA|US|36.68|-76.92
Northridge|OH|US|39.81|-84.2
Wakefield-Peacedale|RI|US|41.45|-71.5
Midway City|CA|US|33.74|-117.99
Richmond Heights|MO|US|38.63|-90.32
Woodburn|VA|US|38.85|-77.24
Spotswood|NJ|US|40.39|-74.4
Mount Rainier|MD|US|38.94|-76.96
Tuscumbia|AL|US|34.73|-87.7
North Elba|NY|US|44.24|-73.95
Gonzales|CA|US|36.51|-121.44
Freetown|MA|US|41.77|-71.03
Indian Harbour Beach|FL|US|28.15|-80.59
Perkasie|PA|US|40.37|-75.29
Jerseyville|IL|US|39.12|-90.33
Fairless Hills|PA|US|40.18|-74.86
Dormont|PA|US|40.4|-80.03
South Kensington|MD|US|39.01|-77.07
Hamilton Worcester|MA|US|42.26|-71.77
Kensington|CT|US|41.64|-72.77
Fallon|NV|US|39.47|-118.78
Elwood|IN|US|40.28|-85.84
Rossmoor|MD|US|39.1|-77.07
Cambridge|MN|US|45.57|-93.22
Haledon|NJ|US|40.94|-74.19
Franklin|NH|US|43.44|-71.65
Road Town||VG|18.43|-64.62
Beverly Hills|FL|US|28.92|-82.46
Greenville|MI|US|43.18|-85.25
Glens Falls North|NY|US|43.34|-73.68
Montvale|NJ|US|41.05|-74.02
Alderwood Manor|WA|US|47.81|-122.26
Boonton|NJ|US|40.9|-74.41
Perry Heights|OH|US|40.8|-81.47
Oak Grove|MN|US|45.34|-93.33
Bryan|OH|US|41.47|-84.55
Yelm|WA|US|46.94|-122.61
Mount Pleasant|IA|US|40.96|-91.56
Audubon|PA|US|40.13|-75.43
Paris|IL|US|39.61|-87.7
Pineville|NC|US|35.08|-80.89
Mason|MI|US|42.58|-84.44
Charlestown|RI|US|41.38|-71.64
Millersville|PA|US|40|-76.35
Los Altos Hills|CA|US|37.38|-122.14
Barrington|NH|US|43.22|-71.05
Riverside|CT|US|41.03|-73.58
Birch Bay|WA|US|48.92|-122.74
Wyoming|OH|US|39.23|-84.47
Lansdowne|MD|US|39.25|-76.66
Lake Elmo|MN|US|45|-92.88
Hoquiam|WA|US|46.98|-123.89
Boonville|MO|US|38.97|-92.74
Bedminster|PA|US|40.43|-75.18
Gateway|FL|US|26.58|-81.75
Bogota|NJ|US|40.88|-74.03
Perryville|MO|US|37.72|-89.86
Siler City|NC|US|35.72|-79.46
Highland Heights|OH|US|41.55|-81.48
Breaux Bridge|LA|US|30.27|-91.9
Harrodsburg|KY|US|37.76|-84.84
Rice Lake|WI|US|45.51|-91.74
August|CA|US|37.98|-121.26
Delavan|WI|US|42.63|-88.64
Guntersville|AL|US|34.36|-86.29
Glenside|PA|US|40.1|-75.15
Menominee|MI|US|45.11|-87.61
Runnemede|NJ|US|39.85|-75.07
Bow Bog|NH|US|43.12|-71.51
Upper Saddle River|NJ|US|41.06|-74.1
Sanatoga|PA|US|40.25|-75.6
Price|UT|US|39.6|-110.81
Floris|VA|US|38.94|-77.41
Tecumseh|MI|US|42|-83.94
Golden Valley|AZ|US|35.22|-114.22
Dalhart|TX|US|36.06|-102.51
Mahopac|NY|US|41.37|-73.73
Saint Joseph|MI|US|42.11|-86.48
Smithfield|VA|US|36.98|-76.63
Lakes|AK|US|61.61|-149.31
Congers|NY|US|41.15|-73.95
Ocean Pointe|HI|US|21.31|-158.04
Bridgeport|WV|US|39.29|-80.26
Brockport|NY|US|43.21|-77.94
Wesley Chapel|NC|US|35.01|-80.67
Half Moon|NC|US|34.83|-77.46
Oberlin|OH|US|41.29|-82.22
Rio Vista|CA|US|38.16|-121.7
Johnstown|NY|US|43.01|-74.37
Tompkinsville|NY|US|40.64|-74.08
Skidaway Island|GA|US|31.93|-81.05
Hornell|NY|US|42.33|-77.66
Roxboro|NC|US|36.39|-78.98
Denison|IA|US|42.02|-95.36
Gering|NE|US|41.83|-103.66
Saint Marys|OH|US|40.54|-84.39
Fairview|TN|US|35.98|-87.12
Firebaugh|CA|US|36.86|-120.46
Mill Creek|PA|US|39.97|-75.22
South Lockport|NY|US|43.15|-78.7
Burtonsville|MD|US|39.11|-76.93
Folsom|PA|US|39.89|-75.33
Hillsboro|TX|US|32.01|-97.13
Center Line|MI|US|42.49|-83.03
Absecon|NJ|US|39.43|-74.5
Fountain Inn|SC|US|34.69|-82.2
Williston|VT|US|44.44|-73.07
Humboldt|TN|US|35.82|-88.92
Litchfield|NH|US|42.84|-71.48
Fort Mitchell|KY|US|39.06|-84.55
Bath|ME|US|43.91|-69.82
North Bay Village|FL|US|25.85|-80.15
Ashland|NJ|US|39.86|-75.01
Doylestown|PA|US|40.31|-75.13
Cedar Hills|OR|US|45.5|-122.8
Mayo|MD|US|38.89|-76.51
Cheviot|OH|US|39.16|-84.61
Arab|AL|US|34.32|-86.5
Shiprock|NM|US|36.79|-108.69
Pleasant Hill|MO|US|38.79|-94.27
Topanga|CA|US|34.09|-118.6
Sugarmill Woods|FL|US|28.73|-82.51
Little Cottonwood Creek Valley|UT|US|40.6|-111.83
Toccoa|GA|US|34.58|-83.33
Hobart|WI|US|44.5|-88.15
Lake Carmel|NY|US|41.46|-73.67
Blanchard|OK|US|35.14|-97.66
Oroville East|CA|US|39.51|-121.48
Seneca|SC|US|34.69|-82.95
Black Mountain|NC|US|35.62|-82.32
Kings Grant|NC|US|34.26|-77.86
Makaha|HI|US|21.47|-158.21
Pike Road|AL|US|32.28|-86.1
Lewistown|PA|US|40.6|-77.57
Croton-on-Hudson|NY|US|41.21|-73.89
East Foothills|CA|US|37.38|-121.82
Bithlo|FL|US|28.55|-81.11
Charles Village|MD|US|39.32|-76.61
Athol|MA|US|42.6|-72.23
Hopkinton|RI|US|41.46|-71.78
Rapid Valley|SD|US|44.06|-103.15
Brookland|DC|US|38.93|-76.98
Rolling Hills Estates|CA|US|33.79|-118.36
Fabens|TX|US|31.5|-106.16
Claymont|DE|US|39.8|-75.46
Nevada|MO|US|37.84|-94.35
Bel Air|CA|US|34.08|-118.45
Bellevue|PA|US|40.49|-80.05
Pleasant Hills|PA|US|40.34|-79.96
The Parks At Walter Reed|DC|US|38.97|-77.03
Elkhorn|NE|US|41.34|-96.26
Wood-Ridge|NJ|US|40.85|-74.09
Conover|NC|US|35.71|-81.22
Castle Shannon|PA|US|40.36|-80.02
Bastrop|TX|US|30.11|-97.32
Vinton|VA|US|37.28|-79.9
Albion|MI|US|42.24|-84.75
Tremonton|UT|US|41.71|-112.17
Helena Valley Southeast|MT|US|46.62|-111.92
Saint Anthony|MN|US|45.02|-93.22
Fair Oaks|GA|US|33.92|-84.54
Sangaree|SC|US|33.04|-80.13
Spring Valley Lake|CA|US|34.49|-117.27
Boiling Springs|SC|US|35.05|-81.98
Oradell|NJ|US|40.96|-74.04
Eaton|OH|US|39.74|-84.64
Bloomingdale|NJ|US|41|-74.33
Kenilworth|NJ|US|40.68|-74.29
Hooper|UT|US|41.16|-112.12
Heath|TX|US|32.84|-96.47
Kenton|OH|US|40.65|-83.61
McFarland|WI|US|43.01|-89.29
Pewaukee|WI|US|43.08|-88.26
Lincoln|MA|US|42.43|-71.3
Ketchikan|AK|US|55.34|-131.65
Tanaina|AK|US|61.63|-149.43
Oak Hills Place|LA|US|30.36|-91.09
Delmar|NY|US|42.62|-73.83
Kulpsville|PA|US|40.24|-75.34
Wynne|AR|US|35.22|-90.79
Grove City|PA|US|41.16|-80.09
Crete|IL|US|41.44|-87.63
Whitehouse|TX|US|32.23|-95.23
Triangle|VA|US|38.55|-77.34
Congress Heights|DC|US|38.84|-77
Ripley|TN|US|35.75|-89.53
Geneseo|NY|US|42.8|-77.82
Laurel|FL|US|27.14|-82.46
East Somerville|MA|US|42.39|-71.08
Farmville|VA|US|37.3|-78.39
Greenbriar|VA|US|38.87|-77.4
Long Grove|IL|US|42.18|-88
Bedminster|NJ|US|40.68|-74.65
Monona|WI|US|43.06|-89.33
Hillsdale|MI|US|41.92|-84.63
Pismo Beach|CA|US|35.14|-120.64
Chestnut Ridge|NY|US|41.08|-74.06
Hillside|IL|US|41.88|-87.9
Trinidad|CO|US|37.17|-104.5
Fairdale|KY|US|38.11|-85.76
Oak Hill|WV|US|37.97|-81.15
Buxton|ME|US|43.64|-70.52
Hailey|ID|US|43.52|-114.32
Savoy|IL|US|40.05|-88.25
Diamondhead|MS|US|30.39|-89.36
Park City|UT|US|40.65|-111.5
London|KY|US|37.13|-84.08
Glover Park|DC|US|38.92|-77.08
Saint Rose|LA|US|29.95|-90.32
Abingdon|VA|US|36.71|-81.98
New Baltimore|VA|US|38.77|-77.73
Mahtomedi|MN|US|45.07|-92.95
Wytheville|VA|US|36.95|-81.08
Brazil|IN|US|39.52|-87.13
Boulder Hill|IL|US|41.71|-88.34
Oakdale|NY|US|42.25|-73.78
Beebe|AR|US|35.07|-91.88
Warrenton|MO|US|38.81|-91.14
Baldwin Harbor|NY|US|40.64|-73.61
Richland Hills|TX|US|32.82|-97.23
Oak Brook|IL|US|41.83|-87.93
Perry|IA|US|41.84|-94.11
Charlestown|IN|US|38.45|-85.67
Flushing|MI|US|43.06|-83.85
Latrobe|PA|US|40.32|-79.38
Hillview|KY|US|38.07|-85.69
Island Lake|IL|US|42.28|-88.19
Manhasset|NY|US|40.8|-73.7
Brookhaven|PA|US|39.87|-75.38
Montpelier|VT|US|44.26|-72.58
West Livingston|TX|US|30.7|-95
Mount Joy|PA|US|40.11|-76.5
South San Gabriel|CA|US|34.05|-118.09
West Frankfort|IL|US|37.9|-88.93
Spanish Fort|AL|US|30.67|-87.92
Ludington|MI|US|43.96|-86.45
Brentwood|MO|US|38.62|-90.35
New Square|NY|US|41.14|-74.03
Mahomet|IL|US|40.2|-88.4
Boston|NY|US|42.63|-78.74
Old Forge|PA|US|41.37|-75.73
Ephrata|WA|US|47.32|-119.55
West Gate|VA|US|38.78|-77.5
Union|SC|US|34.72|-81.62
Bailey|CO|US|39.41|-105.47
Millis|MA|US|42.17|-71.36
Ashland|WI|US|46.59|-90.88
Alamo Heights|TX|US|29.48|-98.47
Raritan|NJ|US|40.57|-74.63
South Beach|NY|US|40.58|-74.08
Belgrade|MT|US|45.78|-111.18
Briarcliff Manor|NY|US|41.15|-73.82
West Cambridge/Harvard Square|MA|US|42.37|-71.12
Londontowne|MD|US|38.93|-76.55
Bothell East|WA|US|47.81|-122.18
Marstons Mills|MA|US|41.66|-70.42
Rayne|LA|US|30.23|-92.27
Ryers|PA|US|40.06|-75.09
Hastings-on-Hudson|NY|US|40.99|-73.88
York|SC|US|34.99|-81.24
Orono|MN|US|44.97|-93.6
Bellevue|OH|US|41.27|-82.84
West Haven-Sylvan|OR|US|45.52|-122.77
Davidsonville|MD|US|38.92|-76.63
Ellsworth Air Force Base|SD|US|44.14|-103.08
Georgia Avenue / Walter Reed|DC|US|38.98|-77.03
Wetumpka|AL|US|32.54|-86.21
West Long Branch|NJ|US|40.29|-74.02
Montrose|VA|US|37.52|-77.38
Grand Blanc|MI|US|42.93|-83.63
Dexter|MO|US|36.8|-89.96
Oak Grove|KY|US|37.34|-86.75
Cheat Lake|WV|US|39.67|-79.85
Wellington|KS|US|37.27|-97.37
Summit|WA|US|47.16|-122.36
Campbell|OH|US|41.08|-80.6
North Star|DE|US|39.76|-75.72
Newton|NJ|US|41.06|-74.75
South Boston|VA|US|36.7|-78.9
West Gate|FL|US|26.7|-80.1
Mascoutah|IL|US|38.49|-89.79
Blair|NE|US|41.54|-96.13
White City|OR|US|42.44|-122.83
Houghton|MI|US|47.12|-88.57
Stayton|OR|US|44.8|-122.79
Senatobia|MS|US|34.62|-89.97
Hyrum|UT|US|41.63|-111.85
Hawthorn Woods|IL|US|42.22|-88.05
Conshohocken|PA|US|40.08|-75.3
Manvel|TX|US|29.46|-95.36
Caldwell|NJ|US|40.84|-74.28
Downingtown|PA|US|40.01|-75.7
Mammoth Lakes|CA|US|37.65|-118.97
Four Corners|MD|US|39.02|-77.01
Maplewood|MO|US|38.61|-90.32
Francisville|KY|US|39.11|-84.72
Bridge City|TX|US|30.02|-93.85
Jefferson|WI|US|43.01|-88.81
Oak Grove|MO|US|39.01|-94.13
Baxter|MN|US|46.34|-94.29
Cumberland Hill|RI|US|41.97|-71.47
Carnegie|PA|US|40.41|-80.08
Ilion|NY|US|43.02|-75.04
Camp Hill|PA|US|40.24|-76.92
Waller|WA|US|47.2|-122.37
Broadview|IL|US|41.86|-87.85
Gold River|CA|US|38.63|-121.25
Sutherlin|OR|US|43.39|-123.31
Crestwood Village|NJ|US|39.95|-74.36
Decorah|IA|US|43.3|-91.79
Colonie|NY|US|42.72|-73.83
Maryville|IL|US|38.72|-89.96
Holly Springs|MS|US|31.32|-89.98
Jersey Village|TX|US|29.89|-95.56
Wahpeton|ND|US|46.27|-96.61
Pike Creek|DE|US|39.73|-75.7
Lake Dallas|TX|US|33.12|-97.03
Wilmington Manor|DE|US|39.69|-75.58
Winnemucca|NV|US|40.97|-117.74
Plaistow|NH|US|42.84|-71.09
University Park|CA|US|33.66|-117.81
Helena Valley West Central|MT|US|46.66|-112.06
Skiatook|OK|US|36.37|-96
Dumbarton|VA|US|37.6|-77.49
Ivins|UT|US|37.17|-113.68
Kirtland|NM|US|36.73|-108.36
Middletown|KY|US|38.25|-85.54
Mill Plain|WA|US|45.64|-122.49
Spring Hill|MA|US|42.39|-71.11
Olivette|MO|US|38.67|-90.38
Sans Souci|SC|US|34.88|-82.42
Antigo|WI|US|45.14|-89.15
Cushing|OK|US|35.99|-96.77
Calumet Park|IL|US|41.66|-87.66
Saint Johns|MI|US|43|-84.56
York|NE|US|40.87|-97.59
Marion|NC|US|35.68|-82.01
Cleveland|TX|US|30.34|-95.09
Lake Purdy|AL|US|33.43|-86.68
Ellsworth|ME|US|44.54|-68.42
Brooksville|FL|US|28.56|-82.39
Creston|IA|US|41.06|-94.36
Southwest Ranches|FL|US|26.06|-80.34
Temple Hills|MD|US|38.81|-76.95
Arcadia|FL|US|27.22|-81.86
Mount Vista|WA|US|45.73|-122.63
Kalifornsky|AK|US|60.42|-151.29
Gilford|NH|US|43.55|-71.41
Memphis|FL|US|27.54|-82.56
Greenville|AL|US|31.83|-86.62
Port Jefferson|NY|US|40.95|-73.07
Bridgewater|MA|US|41.99|-70.98
Sheboygan Falls|WI|US|43.73|-87.82
Fort Scott|KS|US|37.84|-94.71
Port Jefferson Station|NY|US|40.93|-73.05
Sandpoint|ID|US|48.28|-116.55
Quincy|FL|US|30.59|-84.58
Hartsville|SC|US|34.37|-80.07
Lexington|TN|US|35.65|-88.39
Fort Lupton|CO|US|40.08|-104.81
Village Green-Green Ridge|PA|US|39.86|-75.43
Canal Winchester|OH|US|39.84|-82.8
Plainville|MA|US|42|-71.33
Caribou|ME|US|46.86|-68.01
Webster City|IA|US|42.47|-93.82
Milan|TN|US|35.92|-88.76
Wyoming|MN|US|45.34|-93
Tribeca|NY|US|40.72|-74.01
Prien|LA|US|30.18|-93.27
Othello|WA|US|46.83|-119.18
Wellington|CO|US|40.7|-105.01
Garden City Park|NY|US|40.74|-73.66
Bernardsville|NJ|US|40.72|-74.57
Star|ID|US|43.69|-116.49
Winslow|ME|US|44.55|-69.62
Donaldsonville|LA|US|30.1|-90.99
Grand Ledge|MI|US|42.75|-84.75
Crookston|MN|US|47.77|-96.61
Wilson|PA|US|40.68|-75.24
Lake Geneva|WI|US|42.59|-88.43
Lake Stickney|WA|US|47.88|-122.26
White Oak|PA|US|40.34|-79.81
Summit Park|UT|US|40.75|-111.61
Baldwinsville|NY|US|43.16|-76.33
Harrison|TN|US|35.11|-85.14
Murphysboro|IL|US|37.76|-89.34
Newport|AR|US|35.6|-91.28
Glen|MD|US|39.36|-76.69
Fort Riley North|KS|US|39.11|-96.81
Hales Corners|WI|US|42.94|-88.05
Three Rivers|MI|US|41.94|-85.63
Butner|NC|US|36.13|-78.76
Sanger|TX|US|33.36|-97.17
Ruidoso|NM|US|33.33|-105.67
Brevard|NC|US|35.23|-82.73
Saint Martin|MS|US|30.44|-88.87
Carl Junction|MO|US|37.18|-94.57
Scotia|NY|US|42.83|-73.96
River Oaks|TX|US|32.78|-97.39
Dock Junction|GA|US|31.2|-81.52
Mukwonago|WI|US|42.87|-88.33
Wading River|NY|US|40.95|-72.84
Fort Dix|NJ|US|40.03|-74.62
Kennedale|TX|US|32.65|-97.23
Thousand Palms|CA|US|33.82|-116.39
Winsted|CT|US|41.92|-73.06
Hollis|NH|US|42.74|-71.59
Oakdale|LA|US|30.82|-92.66
Bridge City|LA|US|29.93|-90.17
Fern Park|FL|US|28.65|-81.35
Butler|NJ|US|41|-74.34
Ripon|WI|US|43.84|-88.84
Emerson|NJ|US|40.98|-74.03
Saint Johns|MO|US|38.71|-90.34
Hollymead|VA|US|38.12|-78.44
Monahans|TX|US|31.59|-102.89
Lampasas|TX|US|31.06|-98.18
Lander|WY|US|42.83|-108.73
Derby|CO|US|39.84|-104.92
Selah|WA|US|46.65|-120.53
South Beloit|IL|US|42.49|-89.04
Pope Air Force Base (historical)|NC|US|35.17|-79.01
West Helena|AR|US|34.55|-90.64
Kenilworth|DC|US|38.91|-76.94
Sebastopol|CA|US|38.4|-122.82
Galliano|LA|US|29.44|-90.3
Fruitvale|CO|US|39.08|-108.5
Walnut Village|CA|US|33.71|-117.8
Templeton|CA|US|35.55|-120.71
Duvall|WA|US|47.74|-121.99
Kenai|AK|US|60.55|-151.26
Glen Ridge|NJ|US|40.81|-74.2
Dunbar|WV|US|38.36|-81.74
Southwood Acres|CT|US|41.96|-72.57
Woodlake|CA|US|36.41|-119.1
Fanwood|NJ|US|40.64|-74.38
Pittston|PA|US|41.33|-75.79
Quail Hill|CA|US|33.65|-117.78
Ford Island|HI|US|21.35|-157.96
Hubbard|OH|US|41.16|-80.57
Cherry Hill|MD|US|39.25|-76.63
Williamsburg|FL|US|28.41|-81.44
Ridgefield|CT|US|41.28|-73.5
Gilberts|IL|US|42.1|-88.37
Port Wentworth|GA|US|32.15|-81.16
Maple Glen|PA|US|40.02|-79.98
Robinson|IL|US|39.01|-87.74
Halifax|MA|US|41.99|-70.86
Fair Plain|MI|US|42.09|-86.46
Kronenwetter|WI|US|44.82|-89.59
Ojai|CA|US|34.45|-119.24
Fairfax|CA|US|37.99|-122.59
Easton|CT|US|41.25|-73.3
Old Town|ME|US|44.93|-68.65
Hood River|OR|US|45.71|-121.52
Pebble Creek|FL|US|28.15|-82.35
Morehead|KY|US|37.27|-87.18
Hitchcock|TX|US|29.35|-95.02
Jasper|TX|US|30.92|-94
Park City|KS|US|37.8|-97.32
Powdersville|SC|US|34.79|-82.49
Pulaski|TN|US|35.2|-87.03
Ellwood City|PA|US|40.86|-80.29
Evergreen|MT|US|48.23|-114.28
Shorewood|MN|US|44.9|-93.59
West Boylston|MA|US|42.37|-71.79
Sound Beach|NY|US|40.96|-72.97
Brighton|MI|US|42.53|-83.78
Gettysburg|PA|US|39.83|-77.23
Bonner Springs|KS|US|39.06|-94.88
DuBois|PA|US|41.12|-78.76
Yreka|CA|US|41.74|-122.63
Acton|CA|US|34.47|-118.2
Wynnefield Heights|PA|US|40|-75.2
Big Flats Airport|NY|US|42.17|-76.89
Princeton|IL|US|41.37|-89.46
Cheswolde|MD|US|39.36|-76.69
Richfield|UT|US|38.77|-112.08
Berlin|NJ|US|39.79|-74.93
Clear Lake|IA|US|43.14|-93.38
Manor|TX|US|30.34|-97.56
Seaford|DE|US|38.64|-75.61
Inverness|IL|US|42.12|-88.1
Fletcher|NC|US|35.43|-82.5
New Prague|MN|US|44.54|-93.58
Sappington|MO|US|38.54|-90.38
Center Moriches|NY|US|40.8|-72.79
McCook|NE|US|40.2|-100.63
Seffner|FL|US|27.98|-82.28
Newton Upper Falls|MA|US|42.31|-71.22
Willow Street|PA|US|39.98|-76.28
Centerville|GA|US|32.63|-83.69
Dayton|TX|US|30.05|-94.89
Pukalani|HI|US|20.84|-156.34
Sandston|VA|US|37.52|-77.32
St Johnsbury|VT|US|44.43|-72.02
Meadow Lakes|AK|US|61.62|-149.6
Pasadena Hills|FL|US|28.28|-82.22
Catalina|AZ|US|32.51|-110.92
Hillcrest|NY|US|41.13|-74.04
Tiverton|RI|US|41.63|-71.21
Lamar|CO|US|38.09|-102.62
Orland|CA|US|39.75|-122.2
Corning|CA|US|39.93|-122.18
Murrells Inlet|SC|US|33.55|-79.04
River Rouge|MI|US|42.27|-83.13
Gonzales|TX|US|29.5|-97.45
Garnet|CA|US|33.93|-116.48
Yorkshire|VA|US|38.79|-77.45
Rathdrum|ID|US|47.81|-116.9
Waterboro|ME|US|43.54|-70.72
Rhinelander|WI|US|45.64|-89.41
Rockton|IL|US|42.45|-89.07
Auburn|GA|US|34.01|-83.83
Escalon|CA|US|37.8|-121
Seminole|OK|US|35.22|-96.67
Highlands|TX|US|29.82|-95.06
Chester Springs|PA|US|40.1|-75.62
Herkimer|NY|US|43.03|-74.99
Waite Park|MN|US|45.56|-94.22
Connellsville|PA|US|40.02|-79.59
Green|OR|US|43.16|-123.37
Haddon Heights|NJ|US|39.88|-75.06
Lancaster|MA|US|42.46|-71.67
Oak Island|NC|US|33.92|-78.16
Clewiston|FL|US|26.75|-80.93
Iron Mountain|MI|US|45.82|-88.07
Ashland|VA|US|37.76|-77.48
Marengo|IL|US|42.25|-88.61
Saint George's|Saint George Parish|GD|12.05|-61.75
Crystal City|TX|US|28.68|-99.83
Plymouth|MA|US|41.96|-70.67
Melrose Park|FL|US|26.11|-80.19
Silvis|IL|US|41.51|-90.42
Page|AZ|US|36.91|-111.46
Oakland|TN|US|35.23|-89.52
Monessen|PA|US|40.15|-79.89
Saint Louis|MI|US|43.41|-84.61
South Berwick|ME|US|43.23|-70.81
Aurora|MO|US|36.97|-93.72
Navasota|TX|US|30.39|-96.09
Salem|UT|US|40.05|-111.67
Rockville|CT|US|41.87|-72.45
Bemis|MA|US|42.37|-71.2
Swainsboro|GA|US|32.6|-82.33
Citrus Hills|FL|US|28.89|-82.43
Villa Hills|KY|US|39.06|-84.59
Fishersville|VA|US|38.1|-78.97
Sioux Center|IA|US|43.08|-96.18
Pembroke|NH|US|43.15|-71.46
LaFollette|TN|US|36.38|-84.12
Charles City|IA|US|43.07|-92.67
Palmyra|PA|US|40.31|-76.59
Seminole|TX|US|32.72|-102.64
Irondale|GA|US|33.48|-84.36
Nantucket|MA|US|41.28|-70.1
Orting|WA|US|47.1|-122.2
Cotati|CA|US|38.33|-122.71
Twin Rivers|NJ|US|40.26|-74.49
Mentor-on-the-Lake|OH|US|41.71|-81.36
Pinson|AL|US|33.69|-86.68
Lemoore Station|CA|US|36.26|-119.9
Melissa|TX|US|33.29|-96.57
Lugoff|SC|US|34.23|-80.69
Gresham Park|GA|US|33.7|-84.31
Dunellen|NJ|US|40.59|-74.47
Celebration|FL|US|28.33|-81.53
Round Lake Park|IL|US|42.36|-88.08
Calipatria|CA|US|33.13|-115.51
Battery Park City|NY|US|40.71|-74.02
Mount Horeb|WI|US|43.01|-89.74
Independent Hill|VA|US|38.64|-77.44
Brattleboro|VT|US|42.85|-72.56
Joshua Tree|CA|US|34.13|-116.31
Fairlawn|OH|US|41.13|-81.61
Hatboro|PA|US|40.17|-75.11
Washington|IA|US|41.3|-91.69
Fair Oaks Ranch|TX|US|29.75|-98.64
McGregor|FL|US|26.56|-81.91
Ormond-by-the-Sea|FL|US|29.35|-81.07
Mexia|TX|US|31.68|-96.48
Midland Beach|NY|US|40.57|-74.09
Larose|LA|US|29.57|-90.38
Roanoke|TX|US|33|-97.23
Manhattan|IL|US|41.42|-87.99
Globe|AZ|US|33.39|-110.79
West Dundee|IL|US|42.1|-88.28
Park City|IL|US|42.35|-87.88
Philadelphia|MS|US|32.77|-89.12
Chehalis|WA|US|46.66|-122.96
Northport|NY|US|40.9|-73.34
Corbin|KY|US|36.95|-84.1
Clinton|MA|US|42.42|-71.68
Cohasset|MA|US|42.24|-70.8
Glastonbury Center|CT|US|41.7|-72.6
Edgewater Park|NJ|US|40.07|-74.9
Batesville|MS|US|34.31|-89.94
Felida|WA|US|45.71|-122.71
Dayton|TN|US|35.49|-85.01
Sterling|MA|US|42.44|-71.76
Hughson|CA|US|37.6|-120.87
Carneys Point|NJ|US|39.71|-75.47
Tulpehocken|PA|US|40.04|-75.2
Payette|ID|US|44.08|-116.93
Northgate|OH|US|39.25|-84.59
Capitol Gateway|DC|US|38.89|-76.92
Hampton|GA|US|33.39|-84.28
Sandwich|IL|US|41.65|-88.62
Quincy|WA|US|47.23|-119.85
Mansfield Center|MA|US|42.02|-71.22
Saint Augustine Shores|FL|US|29.81|-81.31
Canfield|OH|US|41.03|-80.76
Devils Lake|ND|US|48.11|-98.87
Bay Wood|NY|US|40.75|-73.29
Hampden|MD|US|39.33|-76.63
Albertville|MN|US|45.24|-93.65
Murillo Colonia|TX|US|26.26|-98.11
Aberdeen|NC|US|35.13|-79.43
Morrow|GA|US|33.58|-84.34
La Feria|TX|US|26.16|-97.82
Hudson|NH|US|42.76|-71.44
Flatwoods|KY|US|38.52|-82.72
Collinsville|VA|US|36.72|-79.92
Nebraska City|NE|US|40.68|-95.86
Williston Park|NY|US|40.76|-73.64
Midland Park|NJ|US|40.99|-74.14
Grandview Heights|OH|US|39.98|-83.04
Hudsonville|MI|US|42.87|-85.87
Laughlin|NV|US|35.17|-114.57
Floresville|TX|US|29.13|-98.16
Altoona|WI|US|44.8|-91.44
Interlaken|CA|US|36.95|-121.73
Middleborough Center|MA|US|41.89|-70.93
Woodlake|VA|US|37.42|-77.68
Guadalupe|CA|US|34.97|-120.57
Woodlawn|NY|US|40.9|-73.87
Clarkston|WA|US|46.42|-117.05
Wauseon|OH|US|41.55|-84.14
Jennings Lodge|OR|US|45.39|-122.61
Palmyra|NJ|US|40.01|-75.03
Bloomfield|NM|US|36.71|-107.98
Riverdale Park|MD|US|38.96|-76.93
Franklin|LA|US|29.8|-91.5
Livingston|MT|US|45.66|-110.56
Harrison|WI|US|44.23|-88.34
New Cumberland|PA|US|40.23|-76.88
Hillsborough|NE|US|41.3|-96.13
Fort Bragg|CA|US|39.45|-123.81
Salem|IL|US|38.63|-88.95
Buechel|KY|US|38.2|-85.65
Oceano|CA|US|35.1|-120.61
Hastings|MI|US|42.65|-85.29
Westmere|NY|US|42.69|-73.87
Forest City|NC|US|35.33|-81.87
Lincolnshire|IL|US|42.19|-87.91
Bermuda Dunes|CA|US|33.74|-116.29
Dry Run|OH|US|39.1|-84.33
Green Cove Springs|FL|US|29.99|-81.68
Mead|WA|US|47.77|-117.35
North Springfield|VA|US|38.8|-77.2
Pinon Hills|CA|US|34.43|-117.65
Neptune Beach|FL|US|30.31|-81.4
Odessa|FL|US|28.19|-82.59
Longboat Key|FL|US|27.41|-82.66
Westphalia|MD|US|38.85|-76.81
Ville Platte|LA|US|30.69|-92.27
Lexington|VA|US|37.78|-79.44
Napili-Honokowai|HI|US|20.98|-156.68
Strathmore|NJ|US|40.4|-74.21
Madison|SD|US|44.01|-97.11
Tell City|IN|US|37.95|-86.77
New Dorp|NY|US|40.57|-74.12
Orland Hills|IL|US|41.59|-87.84
Knoxville|IA|US|41.32|-93.11
Homestead Meadows South|TX|US|31.81|-106.16
North Patchogue|NY|US|40.79|-73.01
Bryans Road|MD|US|38.63|-77.07
Smithville|NJ|US|39.49|-74.46
Southport|NY|US|42.05|-76.82
Rockland|ME|US|44.1|-69.11
Sanibel|FL|US|26.45|-82.02
Summit View|WA|US|47.14|-122.35
Osceola|AR|US|35.71|-89.97
Inverness|FL|US|28.84|-82.33
Elkins|WV|US|38.93|-79.85
Beacon Square|FL|US|28.21|-82.76
Swanzey|NH|US|42.87|-72.28
Valley Center|KS|US|37.83|-97.37
Woodland Park|CO|US|38.99|-105.06
Saint Francis|MN|US|45.39|-93.36
Putnam|CT|US|41.92|-71.91
Leola|PA|US|40.09|-76.18
Mount Sterling|KY|US|38.06|-83.94
Mount Vernon|IN|US|40.67|-85.82
Mendota|IL|US|41.55|-89.12
Hiawatha|IA|US|42.04|-91.68
Beaconsfield|MA|US|42.34|-71.14
El Rio|CA|US|34.24|-119.16
Tyrone|GA|US|33.47|-84.6
Winooski|VT|US|44.49|-73.19
Pompano Beach Highlands|FL|US|26.28|-80.11
Hudson Falls|NY|US|43.3|-73.59
Kosciusko|MS|US|33.06|-89.59
Yardville|NJ|US|40.18|-74.66
Makawao|HI|US|20.86|-156.31
Highland Heights|KY|US|39.03|-84.45
Delafield|WI|US|43.06|-88.4
Minnetrista|MN|US|44.94|-93.72
Lake of the Woods|VA|US|38.33|-77.76
Southgate|FL|US|27.31|-82.51
LaFayette|GA|US|34.7|-85.28
Glenolden|PA|US|39.9|-75.29
Pleasantville|NY|US|41.13|-73.79
Great Barrington|MA|US|42.2|-73.36
New London|WI|US|44.39|-88.74
Downtown|MD|US|39.29|-76.62
Douglas|MA|US|42.05|-71.74
Seward|NE|US|40.91|-97.1
Atherton|CA|US|37.46|-122.2
Mills River|NC|US|35.39|-82.57
Shamokin|PA|US|40.79|-76.56
Moanalua Valley|HI|US|21.35|-157.89
Pacific|MO|US|38.48|-90.74
Applewood|CO|US|39.76|-105.16
Heber Springs|AR|US|35.49|-92.03
East Perrine|FL|US|25.61|-80.34
Kaufman|TX|US|32.59|-96.31
Sausalito|CA|US|37.86|-122.49
East Hills|NY|US|40.79|-73.63
Pinehurst|MA|US|42.53|-71.23
Blandon|PA|US|40.44|-75.89
Belen|NM|US|34.66|-106.78
Demopolis|AL|US|32.52|-87.84
Catoosa|OK|US|36.19|-95.75
Trumann|AR|US|35.67|-90.51
Keyport|NJ|US|40.43|-74.2
Gulf Hills|MS|US|30.43|-88.84
Madison Park|NJ|US|40.45|-74.31
West Vero Corridor|FL|US|27.64|-80.49
Marshfield|MO|US|37.34|-92.91
Jessup|MD|US|39.15|-76.78
Sullivan|MO|US|38.21|-91.16
Mantua|VA|US|38.85|-77.26
Independence|OH|US|41.37|-81.64
Bonne Terre|MO|US|37.92|-90.56
Islamorada|FL|US|24.92|-80.63
Parkwood|WA|US|47.53|-122.61
Broadview Park|FL|US|26.1|-80.21
Pomona|NJ|US|39.48|-74.58
Providence|UT|US|41.71|-111.82
Pacific|WA|US|47.26|-122.25
Fayetteville|TN|US|35.15|-86.57
Piedmont|OK|US|35.64|-97.75
Logan|OH|US|39.54|-82.41
Greenville|NY|US|40.99|-73.82
Cuero|TX|US|29.09|-97.29
Vandalia|IL|US|38.96|-89.09
Hempstead|TX|US|30.1|-96.08
Walled Lake|MI|US|42.54|-83.48
Austell|GA|US|33.81|-84.63
Venice Gardens|FL|US|27.07|-82.41
Village Saint George|LA|US|30.36|-91.07
Fort Belvoir|VA|US|38.71|-77.15
Los Serranos|CA|US|33.97|-117.71
Richland|MS|US|32.24|-90.16
Camden|SC|US|34.25|-80.61
Whitefish|MT|US|48.41|-114.34
West Glens Falls|NY|US|43.3|-73.68
New Paltz|NY|US|41.75|-74.09
University Park|IL|US|41.44|-87.68
Ponchatoula|LA|US|30.44|-90.44
Amory|MS|US|33.98|-88.49
Dayton|NJ|US|40.37|-74.51
Fairfield|NJ|US|40.88|-74.31
Ten Hills|MA|US|42.4|-71.09
King|NC|US|36.28|-80.36
Mims|FL|US|28.67|-80.84
Kill Devil Hills|NC|US|36.03|-75.68
Russellville|KY|US|36.85|-86.89
Perry|FL|US|30.12|-83.58
Ocean City|MD|US|38.34|-75.08
Savage|MD|US|39.14|-76.82
Bellbrook|OH|US|39.64|-84.07
Downtown Brooklyn|NY|US|40.69|-73.99
Georgetown|DE|US|38.69|-75.39
Milltown|NJ|US|40.46|-74.44
Clinton|IL|US|40.15|-88.96
Pelham|NY|US|40.91|-73.81
Alta Sierra|CA|US|35.73|-118.55
Marshall|MI|US|42.27|-84.96
Benton|IL|US|38|-88.92
Eden Isle|LA|US|30.23|-89.8
Crete|NE|US|40.63|-96.96
Ridley Park|PA|US|39.88|-75.32
Milton-Freewater|OR|US|45.93|-118.39
Winters|CA|US|38.52|-121.97
Lakes of the Four Seasons|IN|US|41.41|-87.21
Huntingdon|PA|US|40.48|-78.01
Westminster|MA|US|42.55|-71.91
Mount Carmel|IL|US|38.41|-87.76
Savannah|TN|US|35.22|-88.25
San Martin|CA|US|37.08|-121.61
Delphos|OH|US|40.84|-84.34
Huron|OH|US|41.4|-82.56
Withamsville|OH|US|39.06|-84.29
Baltimore Highlands|MD|US|39.23|-76.64
Stratford|NJ|US|39.83|-75.02
Pikeville|KY|US|37.48|-82.52
Dalton|MA|US|42.47|-73.17
Lake Lorraine|FL|US|30.44|-86.57
Umatilla|OR|US|45.92|-119.34
Oak Hill Park|MA|US|42.29|-71.19
Tolleson|AZ|US|33.45|-112.26
Idabel|OK|US|33.9|-94.83
Nyack|NY|US|41.09|-73.92
Eagle Mountain|TX|US|32.89|-97.44
Eglin Village|FL|US|30.46|-86.54
Ione|CA|US|38.35|-120.93
Tamalpais Valley|CA|US|37.88|-122.55
Kenton|OR|US|45.58|-122.68
North Portland|OR|US|45.61|-122.7
East End|AR|US|34.55|-92.34
Pacific Palisades|HI|US|21.43|-157.95
Tallulah|LA|US|32.41|-91.19
Fairfield Glade|TN|US|36|-84.89
Fort Myers Beach|FL|US|26.45|-81.95
North Sarasota|FL|US|27.37|-82.52
Orange Lake|NY|US|41.54|-74.1
Kenwood|OH|US|39.21|-84.37
Old Jefferson|LA|US|30.38|-91.02
Roosevelt|UT|US|40.3|-109.99
Burton|SC|US|32.44|-80.72
Valley Park|MO|US|38.55|-90.49
Middlebury|CT|US|41.53|-73.13
Kingston|RI|US|41.48|-71.52
Linwood|NJ|US|39.34|-74.58
South Weber|UT|US|41.13|-111.93
Freeland|MI|US|43.53|-84.12
Norwich|NY|US|42.53|-75.52
Portage Lakes|OH|US|41.01|-81.53
Cameron Park|TX|US|25.96|-97.48
Cameron Park Colonia|TX|US|25.97|-97.48
Archbald|PA|US|41.49|-75.54
Sturtevant|WI|US|42.7|-87.89
Dade City|FL|US|28.36|-82.2
Scappoose|OR|US|45.75|-122.88
La Junta|CO|US|37.99|-103.54
Bridgeport|MI|US|43.36|-83.88
Stratham Station|NH|US|43.05|-70.9
Black Jack|MO|US|38.79|-90.27
Etowah|NC|US|35.32|-82.59
Laurel|MT|US|45.67|-108.77
Palikir|Pohnpei State|FM|6.92|158.16
Sidney|NE|US|41.14|-102.98
Nolensville|TN|US|35.95|-86.67
Terrace Heights|WA|US|46.61|-120.44
Colonial Heights|TN|US|36.49|-82.5
Live Oak|FL|US|30.29|-82.98
Auburndale|MA|US|42.35|-71.25
Milton|PA|US|41.01|-76.85
Cortland|OH|US|41.33|-80.73
Rumson|NJ|US|40.37|-74
Great Neck Plaza|NY|US|40.79|-73.73
Moapa Valley|NV|US|36.58|-114.47
Gypsum|CO|US|39.65|-106.95
Hickam Field|HI|US|21.34|-157.96
Robinwood|MD|US|39.64|-77.66
Templeton|MA|US|42.56|-72.07
Belle Plaine|MN|US|44.62|-93.77
Saint Albans|VT|US|44.81|-73.08
Galax|VA|US|36.66|-80.92
South Cleveland|TN|US|35.11|-84.89
Homeacre-Lyndora|PA|US|40.87|-79.92
Elkins Park|PA|US|40.08|-75.13
Stratmoor|CO|US|38.77|-104.78
Litchfield|IL|US|39.18|-89.65
Oasis|CA|US|33.47|-116.1
Treasure Island|FL|US|27.77|-82.77
Mountainside|NJ|US|40.67|-74.36
Lucas|TX|US|33.08|-96.58
Gorham|ME|US|43.68|-70.44
Aspen|CO|US|39.19|-106.82
Mount Ivy|NY|US|41.19|-74.03
Tufts University|MA|US|42.41|-71.12
Milford|OH|US|39.18|-84.29
Blackwell|OK|US|36.8|-97.28
Lantana|TX|US|33.09|-97.12
Leitchfield|KY|US|37.48|-86.29
Plaquemine|LA|US|30.29|-91.23
Pollock Pines|CA|US|38.76|-120.59
Viola|NY|US|41.14|-74.08
Ambridge|PA|US|40.59|-80.23
Jackson|WI|US|43.32|-88.17
Mechanicstown|NY|US|41.44|-74.39
Ephraim|UT|US|39.36|-111.59
Laurel Hill|VA|US|38.72|-77.24
Cottage Grove|WI|US|43.08|-89.2
Mira Monte|CA|US|34.43|-119.29
Schriever|LA|US|29.74|-90.81
North Syracuse|NY|US|43.13|-76.13
Pratt|KS|US|37.64|-98.74
Bargersville|IN|US|39.52|-86.17
Carthage|TX|US|32.16|-94.34
Santa Clara|UT|US|37.13|-113.65
Walden|NY|US|41.56|-74.19
Huron|CA|US|36.2|-120.1
Loomis|CA|US|38.82|-121.19
Orchard Mesa|CO|US|39.05|-108.53
Newport|TN|US|35.97|-83.19
Atlantic|IA|US|41.4|-95.01
Nevada|IA|US|42.02|-93.45
Mantua|PA|US|39.96|-75.19
Tamaqua|PA|US|40.8|-75.97
Middleton|ID|US|43.71|-116.62
Sidney|MT|US|47.72|-104.16
Roeland Park|KS|US|39.04|-94.63
Sequim|WA|US|48.08|-123.1
Warwick|NY|US|41.26|-74.36
Allendale|NJ|US|41.04|-74.13
North Amherst|MA|US|42.41|-72.53
Hewlett|NY|US|40.64|-73.7
Winthrop Harbor|IL|US|42.48|-87.82
Barrington|NJ|US|39.86|-75.06
Carmel Hamlet|NY|US|41.41|-73.69
Buena Vista|MI|US|43.42|-83.9
Wickenburg|AZ|US|33.97|-112.73
Tuttle|OK|US|35.29|-97.81
Stevensville|MD|US|38.98|-76.31
Darnestown|MD|US|39.1|-77.29
Lockwood|MT|US|45.82|-108.41
Valletta|Valletta|MT|35.9|14.51
Kirtland|OH|US|41.63|-81.36
Whitemarsh Island|GA|US|32.03|-81.02
Hornsby Bend|TX|US|30.25|-97.58
Myers Corner|NY|US|41.61|-73.87
Groesbeck|OH|US|39.22|-84.59
Lake City|SC|US|33.87|-79.76
Palmer|AK|US|61.6|-149.11
Nappanee|IN|US|41.44|-86
Stickney|IL|US|41.82|-87.78
Martins Ferry|OH|US|40.1|-80.72
Landen|OH|US|39.31|-84.28
Atkinson|NH|US|42.84|-71.15
Stanwood|WA|US|48.24|-122.37
Crescent City|CA|US|41.76|-124.2
Gibsonville|NC|US|36.11|-79.54
Hamilton|AL|US|34.14|-87.99
Cos Cob|CT|US|41.03|-73.6
Fairview|GA|US|34.95|-85.28
Taylor Mill|KY|US|39|-84.5
East Porterville|CA|US|36.06|-118.98
Clackamas|OR|US|45.41|-122.57
Ogden|NC|US|34.27|-77.82
Bayville|NY|US|40.91|-73.56
Nitro|WV|US|38.41|-81.84
West Point|NY|US|41.39|-73.96
Commerce|GA|US|34.2|-83.46
Belle Harbor|NY|US|40.58|-73.85
Bowleys Quarters|MD|US|39.34|-76.39
Fox Point|WI|US|43.16|-87.9
Grove|OK|US|36.59|-94.77
West Bridgewater|MA|US|42.02|-71.01
Mount Olympus|UT|US|40.69|-111.79
Souderton|PA|US|40.31|-75.33
Brook Highland|AL|US|33.44|-86.67
Taneytown|MD|US|39.66|-77.17
Greenbrier|TN|US|36.43|-86.8
Manorhaven|NY|US|40.84|-73.71
Kimberly|WI|US|44.27|-88.34
Morrilton|AR|US|35.15|-92.74
Willow Oak|FL|US|27.92|-82.02
Aquia Harbour|VA|US|38.46|-77.39
Milton Upper Mills|MA|US|42.26|-71.1
Brandywine|MD|US|38.7|-76.85
Church Hill|TN|US|36.52|-82.71
Anadarko|OK|US|35.07|-98.24
Marion|SC|US|34.18|-79.4
Watford City|ND|US|47.8|-103.28
De Queen|AR|US|34.04|-94.34
Oyster Bay|NY|US|40.87|-73.53
Parkville|PA|US|39.78|-76.96
Wedgefield|FL|US|28.49|-81.08
Whitinsville|MA|US|42.11|-71.67
Farmington|AR|US|36.04|-94.25
Millersville|TN|US|36.37|-86.71
Longwood - Winton Grove|CA|US|37.66|-122.11
'Ewa Villages-Honouliuli|HI|US|21.35|-158.05
Big Park|AZ|US|34.78|-111.76
Lower Allen|PA|US|40.23|-76.9
Belle Isle|FL|US|28.46|-81.36
Thomson|GA|US|33.47|-82.5
Silsbee|TX|US|30.35|-94.18
Sturgis|SD|US|44.41|-103.51
Fircrest|WA|US|47.24|-122.52
West View|PA|US|40.52|-80.03
Clifton Heights|PA|US|39.93|-75.3
Flowery Branch|GA|US|34.19|-83.93
Ettrick|VA|US|37.24|-77.43
Belfast|ME|US|44.43|-69.01
Cedarhurst|NY|US|40.62|-73.72
Seneca Falls|NY|US|42.91|-76.8
Clairton|PA|US|40.29|-79.88
Air Force Academy|CO|US|38.99|-104.86
North Bend|WA|US|47.5|-121.79
Eagle|CO|US|39.66|-106.83
Saint Gabriel|LA|US|30.26|-91.1
Dillon|SC|US|34.42|-79.37
Scottsburg|IN|US|38.69|-85.77
Garden Home-Whitford|OR|US|45.46|-122.76
South Hill|NY|US|42.41|-76.48
Woodridge|DC|US|38.93|-76.97
Oak Ridge|NC|US|36.17|-79.99
Carbondale|CO|US|39.4|-107.21
Trinity|NC|US|35.89|-79.99
Valley City|ND|US|46.92|-98
Torrington|WY|US|42.06|-104.18
Welcome|SC|US|34.83|-82.44
Normandy Park|WA|US|47.44|-122.34
Greenville|IL|US|38.89|-89.41
Noble|OK|US|35.14|-97.39
East Rochester|NY|US|43.11|-77.49
East Shoreham|NY|US|40.94|-72.88
North Riverside|IL|US|41.84|-87.82
Madras|OR|US|44.63|-121.13
North Caldwell|NJ|US|40.86|-74.26
Ancient Oaks|PA|US|40.55|-75.59
Opp|AL|US|31.28|-86.26
Litchfield|MN|US|45.13|-94.53
Boyes Hot Springs|CA|US|38.31|-122.48
Brier|WA|US|47.78|-122.27
Glen Oaks|NY|US|40.75|-73.71
Wollochet|WA|US|47.27|-122.58
Hapeville|GA|US|33.66|-84.41
Pea Ridge|WV|US|38.41|-82.32
Montevallo|AL|US|33.1|-86.86
Pingree Grove|IL|US|42.07|-88.41
Elsa|TX|US|26.29|-97.99
Thermalito|CA|US|39.51|-121.59
Tuckahoe|NY|US|40.95|-73.83
Viera West|FL|US|28.25|-80.73
Airway Heights|WA|US|47.64|-117.59
Folcroft|PA|US|39.89|-75.28
Tecumseh|OK|US|35.26|-96.94
Camp H.M. Smith|HI|US|21.38|-157.91
Barnesville|GA|US|33.05|-84.16
Elmendorf Air Force Base|AK|US|61.26|-149.63
North Vernon|IN|US|39.01|-85.62
Green Hill|TN|US|36.22|-86.55
Buena Vista|VA|US|37.73|-79.35
East Glenville|NY|US|42.89|-73.93
Horseheads|NY|US|42.17|-76.82
Farr West|UT|US|41.3|-112.03
Oneonta|AL|US|33.95|-86.47
Wharton|NJ|US|40.89|-74.58
Tappan|NY|US|41.02|-73.95
Youngtown|AZ|US|33.59|-112.3
Batesville|IN|US|39.3|-85.22
Old Greenwich|CT|US|41.02|-73.56
Gleneagle|CO|US|39.05|-104.82
California|PA|US|40.07|-79.89
Irvington|NY|US|41.04|-73.87
Lacy-Lakeview|TX|US|31.63|-97.1
Emmett|ID|US|43.87|-116.5
Springs|NY|US|41.02|-72.16
Wildwood|FL|US|28.87|-82.04
Middlebury (village)|VT|US|44.02|-73.17
Shields|MI|US|43.42|-84.06
Centerville|SC|US|34.53|-82.7
Strasburg|VA|US|38.99|-78.36
Saint John|MO|US|38.71|-90.35
Carrollton|MI|US|43.46|-83.93
Forest Glen|MD|US|39.01|-77.05
Los Fresnos|TX|US|26.07|-97.48
Gridley|CA|US|39.36|-121.69
Rittman|OH|US|40.98|-81.78
Roslyn Heights|NY|US|40.79|-73.65
Bridesburg|PA|US|40|-75.07
Lake Shore|WA|US|45.69|-122.69
Canton|NY|US|44.6|-75.17
Lower Allston|MA|US|42.36|-71.13
Cochituate|MA|US|42.32|-71.36
Siesta Key|FL|US|27.27|-82.55
Richboro|PA|US|40.22|-75.01
Bedford|VA|US|37.33|-79.52
Lawrence|NY|US|40.62|-73.73
Abilene|KS|US|38.92|-97.21
Hillsboro|OH|US|39.2|-83.61
Crockett|TX|US|31.32|-95.46
West Slope|OR|US|45.5|-122.76
Southeast Arcadia|FL|US|27.19|-81.85
Henderson|TN|US|35.44|-88.64
Brook Farm|MA|US|42.29|-71.16
Lago Vista|TX|US|30.46|-97.99
West Fens|MA|US|42.34|-71.1
Unionville|NC|US|35.09|-80.51
Ellettsville|IN|US|39.23|-86.62
Inverness Highlands South|FL|US|28.8|-82.34
Seaside|OR|US|45.99|-123.92
Silver Springs Shores|FL|US|29.1|-82.02
Cherry Hills Village|CO|US|39.64|-104.96
Geneseo|IL|US|41.45|-90.15
Laurence Harbor|NJ|US|40.46|-74.25
Yorketown|NJ|US|40.31|-74.34
Lake Hallie|WI|US|44.88|-91.44
Saint Joseph|MN|US|45.56|-94.32
North Brighton|MA|US|42.36|-71.14
Douglas|WY|US|42.76|-105.38
Eliot|ME|US|43.15|-70.8
Upper Sandusky|OH|US|40.83|-83.28
Catasauqua|PA|US|40.65|-75.47
Lincoln|AL|US|33.61|-86.12
New Milford|CT|US|41.58|-73.41
Riverside|MD|US|39.27|-76.61
Decatur|TX|US|33.23|-97.59
Eatonton|GA|US|33.33|-83.39
Boyette|FL|US|27.82|-82.22
Belle Haven|VA|US|38.79|-77.06
Rossford|OH|US|41.61|-83.56
Calverton|NY|US|40.91|-72.74
Monticello|NY|US|41.66|-74.69
Ambler|PA|US|40.15|-75.22
Avon|CO|US|39.63|-106.52
Lutherville|MD|US|39.42|-76.63
Washington|NJ|US|40.76|-74.98
Ladera Heights|CA|US|33.99|-118.38
Champion Heights|OH|US|41.29|-80.85
Vandenberg Village|CA|US|34.71|-120.47
De Soto|MO|US|38.14|-90.56
Rockaway|NJ|US|40.9|-74.51
Hurricane|WV|US|38.43|-82.02
Collinsville|OK|US|36.36|-95.84
Johnson Lane|NV|US|39.05|-119.72
Macclenny|FL|US|30.28|-82.12
Lovejoy|GA|US|33.44|-84.31
Cheverly|MD|US|38.93|-76.92
Kentfield|CA|US|37.95|-122.56
East Farmingdale|NY|US|40.73|-73.42
Medfield|MA|US|42.19|-71.31
Ishpeming|MI|US|46.49|-87.67
Prospect Park|PA|US|39.89|-75.31
Castroville|CA|US|36.77|-121.76
Belpre|OH|US|39.27|-81.57
Brookings|OR|US|42.05|-124.28
Fort Pierce North|FL|US|27.47|-80.36
Spring Lake Park|MN|US|45.11|-93.24
Milford|MI|US|42.59|-83.6
Plattsmouth|NE|US|41.01|-95.88
Powell|WY|US|44.75|-108.76
Union|OH|US|39.9|-84.31
Lauderdale-by-the-Sea|FL|US|26.19|-80.1
Ridgefield|WA|US|45.82|-122.74
Lihue|HI|US|21.98|-159.37
University Town Center|CA|US|33.65|-117.83
Thurmont|MD|US|39.62|-77.41
Hamlet|NC|US|34.88|-79.69
Lanett|AL|US|32.87|-85.19
Kula|HI|US|20.79|-156.33
Nibley|UT|US|41.67|-111.83
Bethel|AK|US|60.79|-161.76
Covedale|OH|US|39.12|-84.61
Geneva|OH|US|39.66|-82.43
Nuevo|CA|US|33.8|-117.15
Mattydale|NY|US|43.1|-76.15
Forest Hills|PA|US|40.42|-79.85
Oakmont|PA|US|40.52|-79.84
Sudden Valley|WA|US|48.72|-122.35
Pocahontas|AR|US|36.26|-90.97
Bronxville|NY|US|40.94|-73.83
Wheelersburg|OH|US|38.73|-82.86
Landing|NJ|US|40.91|-74.67
Hudson|NY|US|42.25|-73.79
Kermit|TX|US|31.86|-103.09
South Monroe|MI|US|41.9|-83.42
Gladewater|TX|US|32.54|-94.94
Exeter|RI|US|41.58|-71.54
Solvay|NY|US|43.06|-76.21
Cynthiana|KY|US|38.39|-84.29
Whitmore Lake|MI|US|42.44|-83.75
Corry|PA|US|41.92|-79.64
Monument|CO|US|39.09|-104.87
Hillsborough|NC|US|36.08|-79.1
Angora|PA|US|39.94|-75.24
Talent|OR|US|42.25|-122.79
Riverton|WA|US|47.48|-122.29
Holtville|CA|US|32.81|-115.38
Inwood|FL|US|28.04|-81.77
Sealy|TX|US|29.78|-96.16
Dahlonega|GA|US|34.53|-83.98
West Somerville/Davis Square|MA|US|42.4|-71.12
Waveland|MS|US|30.29|-89.38
Milliken|CO|US|40.33|-104.86
Camp Swift|TX|US|30.19|-97.29
Bartonville|IL|US|40.65|-89.65
Blue Grass|PA|US|40.07|-75.03
Bridgeport|TX|US|33.21|-97.75
Eudora|KS|US|38.94|-95.1
Mattapoisett|MA|US|41.66|-70.82
Wimauma|FL|US|27.71|-82.3
Moraine|OH|US|39.71|-84.22
Purcell|OK|US|35.01|-97.36
Prairie View|TX|US|30.09|-95.99
Fort Lincoln|DC|US|38.92|-76.96
Cherry Valley|CA|US|33.97|-116.98
Hampstead|MD|US|39.6|-76.85
Bremen|GA|US|33.72|-85.15
Everman|TX|US|32.63|-97.29
Bellwood|VA|US|37.42|-77.44
Howland Center|OH|US|41.25|-80.75
Woodfin|NC|US|35.63|-82.58
Pelican Bay|FL|US|26.23|-81.81
White Oak|TX|US|32.53|-94.86
Walnut Hills|OH|US|39.13|-84.48
Iowa Park|TX|US|33.95|-98.67
Garrett|IN|US|41.35|-85.14
Eastwood|MI|US|42.3|-85.55
Huntington Woods|MI|US|42.48|-83.17
Morton|PA|US|40.04|-75.18
Edinboro|PA|US|41.87|-80.13
Metropolis|IL|US|37.15|-88.73
Blakely|PA|US|41.48|-75.59
Linglestown|PA|US|40.33|-76.79
Pembroke Park|FL|US|25.99|-80.17
Leesville|LA|US|31.14|-93.26
Arlington Heights|PA|US|40.99|-75.22
Kathleen|FL|US|28.12|-82.02
Glenarden|MD|US|38.93|-76.86
Clarkston Heights-Vineland|WA|US|46.39|-117.08
Roseland|CA|US|38.42|-122.73
Gulf Breeze|FL|US|30.36|-87.16
Red Lion|PA|US|39.9|-76.61
Canutillo|TX|US|31.91|-106.6
Funafuti|Funafuti|TV|-8.52|179.19
Walker|LA|US|30.49|-90.86
Mulvane|KS|US|37.47|-97.24
Louisville|MS|US|33.12|-89.06
Willis|TX|US|30.42|-95.48
Johnsburg|IL|US|42.38|-88.24
Selma|NC|US|35.54|-78.28
Franklin|PA|US|41.4|-79.83
Zuni Pueblo|NM|US|35.07|-108.85
Valley Falls|SC|US|35.02|-81.97
Plain City|UT|US|41.3|-112.09
Skowhegan|ME|US|44.77|-69.72
Parkville|MO|US|39.2|-94.68
Homeland Park|SC|US|34.47|-82.67
Bee Cave|TX|US|30.31|-97.95
Columbiana|OH|US|40.89|-80.69
Rolesville|NC|US|35.92|-78.46
Wendell|NC|US|35.78|-78.37
Dighton|MA|US|41.81|-71.12
Fairmount|MA|US|42.25|-71.11
Marble Falls|TX|US|30.58|-98.28
South Williamsport|PA|US|41.23|-77
Carlstadt|NJ|US|40.84|-74.09
Spreckelsville|HI|US|20.9|-156.41
Back of the Hill|MA|US|42.33|-71.11
Knottsville|KY|US|37.77|-86.9
Fowler|CA|US|36.63|-119.68
Enoch|UT|US|37.77|-113.02
Red Chute|LA|US|32.56|-93.61
Clyde|OH|US|41.3|-82.98
Estes Park|CO|US|40.38|-105.52
Shrewsbury|MO|US|38.59|-90.34
Kodiak|AK|US|57.79|-152.41
Bellefonte|PA|US|40.91|-77.78
Wilmore|KY|US|37.86|-84.66
Merrimac|MA|US|42.83|-71
Jackson|OH|US|39.05|-82.64
Danville|AL|US|34.41|-87.09
Ave Maria|FL|US|26.34|-81.44
Ramtown|NJ|US|40.12|-74.14
Burnet|TX|US|30.76|-98.23
Margate City|NJ|US|39.33|-74.5
East Aurora|NY|US|42.77|-78.61
Dunlap|IN|US|41.64|-85.92
Ben Lomond|CA|US|37.09|-122.09
Eldridge|IA|US|41.66|-90.58
Columbia|MS|US|31.25|-89.84
Conley|GA|US|33.64|-84.33
Cullowhee|NC|US|35.31|-83.18
Chillicothe|IL|US|40.92|-89.49
Kingston|NH|US|42.94|-71.05
Harriman|TN|US|35.93|-84.55
Mila Doce|TX|US|26.23|-97.96
Harrisville|UT|US|41.28|-111.99
Hobart|WA|US|47.42|-121.97
Indian River Estates|FL|US|27.36|-80.31
Aptos|CA|US|36.98|-121.9
Otis Orchards-East Farms|WA|US|47.71|-117.08
Pittville|PA|US|40.06|-75.14
Salem|IN|US|38.61|-86.1
Swarthmore|PA|US|39.9|-75.35
Steilacoom|WA|US|47.17|-122.6
Tarrant|AL|US|33.58|-86.77
East Garden City|NY|US|40.73|-73.6
Pepper Pike|OH|US|41.48|-81.46
New Dorp Beach|NY|US|40.57|-74.1
Saint-Pierre|Saint-Pierre|PM|46.78|-56.18
Green Knoll|NJ|US|40.6|-74.61
Orange City|IA|US|43.01|-96.06
Old City|PA|US|39.95|-75.15
Saint Johnsbury|VT|US|44.42|-72.02
Lionville|PA|US|40.05|-75.66
Raton|NM|US|36.9|-104.44
Portland|IN|US|40.43|-84.98
Satsuma|AL|US|30.85|-88.06
Waltherson|MD|US|39.35|-76.56
Marvin|NC|US|34.99|-80.81
Keene|TX|US|32.4|-97.32
Boonville|IN|US|38.05|-87.27
Inniswold|LA|US|30.4|-91.08
Goddard|MD|US|38.99|-76.85
Plymouth Meeting|PA|US|40.1|-75.27
Guadalupe|AZ|US|33.37|-111.96
Saint Augustine Beach|FL|US|29.85|-81.27
East Alton|IL|US|38.88|-90.11
Princeton|KY|US|37.11|-87.88
Killingworth|CT|US|41.36|-72.56
Braidwood|IL|US|41.27|-88.21
Elm Grove|WI|US|43.04|-88.08
Pigeon Forge|TN|US|35.79|-83.55
Schuyler|NE|US|41.45|-97.06
Cold Spring|KY|US|39.02|-84.44
Ware|MA|US|42.26|-72.24
Holly|MI|US|42.79|-83.63
Kennett Square|PA|US|39.85|-75.71
Northborough|MA|US|42.32|-71.64
Grafton|OH|US|41.27|-82.05
Jamul|CA|US|32.72|-116.88
Sandtown-Winchester|MD|US|39.3|-76.64
International Falls|MN|US|48.6|-93.41
Darlington|SC|US|34.3|-79.88
Bella Vista|PA|US|39.94|-75.16
Sky Lake|FL|US|28.46|-81.39
Oelwein|IA|US|42.67|-91.91
Pauls Valley|OK|US|34.74|-97.22
Aztec|NM|US|36.82|-107.99
Village of Oak Creek (Big Park)|AZ|US|34.78|-111.76
Elsmere|DE|US|39.74|-75.6
Miramar Beach|FL|US|30.37|-86.36
District Heights|MD|US|38.86|-76.89
East Pasadena|CA|US|34.14|-118.07
Groveland|MA|US|42.76|-71.03
Keolu Hills|HI|US|21.38|-157.73
La'ie|HI|US|21.65|-157.92
Carolina Beach|NC|US|34.04|-77.89
Bell Road (historical)|PA|US|39.91|-75.23
Lincroft|NJ|US|40.33|-74.12
West Greenwich|RI|US|41.64|-71.66
Rockford|MI|US|43.12|-85.56
Lynchburg|TN|US|35.28|-86.37
Larchmont|NY|US|40.93|-73.75
Theodore|AL|US|30.55|-88.18
Hampshire|IL|US|42.1|-88.53
Eldorado at Santa Fe|NM|US|35.53|-105.93
Orlovista|FL|US|28.54|-81.46
Kasson|MN|US|44.03|-92.75
Brunswick|MD|US|39.31|-77.63
Saint Martinville|LA|US|30.13|-91.83
Ontario|OH|US|40.76|-82.59
Enola|PA|US|40.29|-76.93
Monroeville|AL|US|31.53|-87.32
Stone Mountain|GA|US|33.81|-84.17
Munford|TN|US|35.45|-89.82
'Ewa Villages|HI|US|21.34|-158.04
Patterson|LA|US|29.69|-91.3
Oxford|MA|US|42.12|-71.86
Twin Lakes|CO|US|39.82|-105
Childress|TX|US|34.43|-100.2
Osprey|FL|US|27.2|-82.49
Ulysses|KS|US|37.58|-101.36
Pimmit Hills|VA|US|38.91|-77.2
Twin Lakes|WI|US|42.53|-88.25
Sheridan|OR|US|45.1|-123.39
Lucas Valley-Marinwood|CA|US|38.04|-122.58
Monticello|KY|US|36.83|-84.85
Littlefield|TX|US|33.92|-102.32
Clarion|PA|US|41.21|-79.39
Harvard|MA|US|42.5|-71.58
Manistee|MI|US|44.24|-86.32
Indiantown|FL|US|27.03|-80.49
Latimer|MS|US|30.53|-88.87
Truth or Consequences|NM|US|33.13|-107.25
Rushville|IN|US|39.61|-85.45
Queen Village|PA|US|39.93|-75.15
Jordan|MN|US|44.67|-93.63
Gunnison|CO|US|38.55|-106.93
De Soto|KS|US|38.98|-94.97
Slaton|TX|US|33.44|-101.64
Fruit Heights|UT|US|41.03|-111.9
Pahokee|FL|US|26.82|-80.67
Willows|CA|US|39.52|-122.19
Blue Bell|PA|US|40.15|-75.27
Joshua|TX|US|32.46|-97.39
Rochester|IN|US|41.06|-86.22
Willard|OH|US|41.05|-82.73
Los Ranchos de Albuquerque|NM|US|35.16|-106.64
Bangor Trident Base|WA|US|47.72|-122.71
Avra Valley|AZ|US|32.44|-111.32
Sylvester|GA|US|31.53|-83.84
Rindge|NH|US|42.75|-72.01
Sunnyvale|TX|US|32.8|-96.56
Hillandale|MD|US|39.03|-76.97
Mount Healthy|OH|US|39.23|-84.55
Sheridan|CO|US|39.65|-105.03
East Falmouth|MA|US|41.58|-70.56
Stewartville|MN|US|43.86|-92.49
Las Flores|CA|US|34.04|-118.64
Union Gap|WA|US|46.56|-120.48
Bay Harbor Islands|FL|US|25.89|-80.13
Huntingburg|IN|US|38.3|-86.95
Princeton|WV|US|37.37|-81.1
Somerset|PA|US|40.01|-79.08
Cambria|CA|US|35.56|-121.08
Berthoud|CO|US|40.31|-105.08
Kingsland|TX|US|30.66|-98.44
Clearfield|PA|US|41.03|-78.44
Fair Haven|NJ|US|40.36|-74.04
Jamesburg|NJ|US|40.35|-74.44
Independence|IA|US|42.47|-91.89
West Concord|MA|US|42.46|-71.4
Taylor|PA|US|41.39|-75.71
Surfside|FL|US|25.88|-80.13
Meridianville|AL|US|34.85|-86.57
Yoakum|TX|US|29.29|-97.15
Old Tappan|NJ|US|41.01|-73.99
Lakemoor|IL|US|42.33|-88.2
Waupaca|WI|US|44.36|-89.09
Whitestown|IN|US|40|-86.35
West Yarmouth|MA|US|41.65|-70.24
Finley|WA|US|46.15|-119.03
Estherville|IA|US|43.4|-94.83
Northville|MI|US|42.43|-83.48
Lake Mohegan|NY|US|41.32|-73.85
McKees Rocks|PA|US|40.47|-80.07
West Haven|OR|US|45.52|-122.77
Roanoke|AL|US|33.15|-85.37
Stow|MA|US|42.44|-71.51
Countryside|IL|US|41.78|-87.88
Battlefield|MO|US|37.12|-93.37
James Island|SC|US|32.72|-79.96
Albion|NY|US|43.25|-78.19
Ralston|NE|US|41.21|-96.04
Walkersville|MD|US|39.49|-77.35
Posen|IL|US|41.63|-87.68
Hartford City|IN|US|40.45|-85.37
Paulsboro|NJ|US|39.83|-75.24
Maquoketa|IA|US|42.07|-90.67
Gustavia||BL|17.9|-62.85
Gun Barrel City|TX|US|32.33|-96.15
Milan|MI|US|42.09|-83.68
Spring Hill|KS|US|38.74|-94.83
Glenham-Belhar|MD|US|39.35|-76.55
Erwin|TN|US|36.15|-82.42
Peoria Heights|IL|US|40.75|-89.57
Cut Off|LA|US|29.54|-90.34
Fort Meade|FL|US|27.75|-81.8
Cherryville|NC|US|35.38|-81.38
Medina|MN|US|45.04|-93.58
Notre Dame|IN|US|41.7|-86.24
North Manchester|IN|US|41|-85.77
Kekaha-Waimea|HI|US|21.97|-159.69
Homeland|CA|US|33.74|-117.11
Gas City|IN|US|40.49|-85.61
Naples Park|FL|US|26.26|-81.81
Northern Liberties|PA|US|39.97|-75.15
Belmont|VA|US|39.06|-77.51
West Miami|FL|US|25.76|-80.3
Villa Park|CA|US|33.81|-117.81
South Valley Stream|NY|US|40.66|-73.72
Marion|VA|US|36.83|-81.51
Port Clinton|OH|US|41.51|-82.94
Chickasaw|AL|US|30.76|-88.07
Prospect Park|NJ|US|40.94|-74.17
Alpine|TX|US|30.36|-103.66
Silver Hill|MD|US|38.84|-76.95
Du Quoin|IL|US|38.01|-89.24
Yaphank|NY|US|40.84|-72.92
Pontotoc|MS|US|34.25|-89
Wailea|HI|US|20.69|-156.44
Wesley Hills|NY|US|41.16|-74.07
Colusa|CA|US|39.21|-122.01
Steelton|PA|US|40.24|-76.84
Sweetwater|TN|US|35.6|-84.46
Topsham|ME|US|43.93|-69.98
Caruthersville|MO|US|36.19|-89.66
Laveen|AZ|US|33.36|-112.17
Hebron|KY|US|39.07|-84.7
Glendale|MO|US|38.6|-90.38
Rensselaer|IN|US|40.94|-87.15
Cocoa West|FL|US|28.36|-80.77
Progreso|TX|US|26.09|-97.96
Hilton|NY|US|43.29|-77.79
East Port Orchard|WA|US|47.52|-122.62
Walpole|MA|US|42.14|-71.25
Woodcliff Lake|NJ|US|41.02|-74.07
Watchung|NJ|US|40.64|-74.45
Little Silver|NJ|US|40.34|-74.05
Roseburg North|OR|US|43.27|-123.35
West Hattiesburg|MS|US|31.32|-89.38
Yorktown|PA|US|39.97|-75.15
Ramblewood|NJ|US|39.93|-74.94
New Whiteland|IN|US|39.56|-86.1
Reservoir|MA|US|42.33|-71.15
Brookville|OH|US|39.84|-84.41
James City|NC|US|35.09|-77.03
Charles Town|WV|US|39.29|-77.86
Attalla|AL|US|34.02|-86.09
Norwood|PA|US|39.89|-75.3
Carrizo Springs|TX|US|28.52|-99.86
Heathrow|FL|US|28.76|-81.37
Trenton|MO|US|40.08|-93.62
Raleigh Hills|OR|US|45.48|-122.76
Robertsdale|AL|US|30.55|-87.71
Bellevue|KY|US|39.11|-84.48
Central City|KY|US|37.29|-87.12
Tanglewilde-Thompson Place|WA|US|47.05|-122.78
Tanglewilde|WA|US|47.05|-122.78
Harrah|OK|US|35.49|-97.16
Laurel Bay|SC|US|32.45|-80.78
New Brighton|PA|US|40.73|-80.31
Bridgewater|VA|US|38.38|-78.98
Vancleave|MS|US|30.54|-88.69
Fulshear|TX|US|29.69|-95.9
Lecanto|FL|US|28.85|-82.49
Dickson City|PA|US|41.47|-75.61
Roseland|NJ|US|40.82|-74.29
Crafton|PA|US|40.44|-80.07
South Patrick Shores|FL|US|28.2|-80.61
Delano|MN|US|45.04|-93.79
Lewistown|MT|US|47.06|-109.43
Chesapeake Beach|MD|US|38.69|-76.53
Wescosville|PA|US|40.57|-75.55
Yarmouth|ME|US|43.8|-70.19
Norwood|NJ|US|41|-73.96
Prosser|WA|US|46.21|-119.77
Zephyrhills West|FL|US|28.23|-82.21
Richmond|MI|US|42.81|-82.76
Mount Zion|IL|US|39.77|-88.87
Portland|CT|US|41.57|-72.64
Punxsutawney|PA|US|40.94|-78.97
Lee Acres|NM|US|35.15|-106.65
Plumas Lake|CA|US|39.02|-121.56
Dowagiac|MI|US|41.98|-86.11
Orange Beach|AL|US|30.29|-87.57
Shawmont|PA|US|40.05|-75.24
Berkley|MA|US|41.85|-71.08
Kingston|TN|US|35.88|-84.51
Junction City|OR|US|44.22|-123.21
Woodland|WA|US|45.9|-122.74
Country Homes|WA|US|47.75|-117.4
Buckner|KY|US|38.38|-85.44
Simsbury Center|CT|US|41.88|-72.81
Plymouth|PA|US|41.24|-75.94
High Springs|FL|US|29.83|-82.6
Sandown|NH|US|42.93|-71.19
Medina|NY|US|43.22|-78.39
Hellertown|PA|US|40.58|-75.34
Byron Center|MI|US|42.81|-85.72
Heathcote|NJ|US|40.39|-74.58
Bensley|VA|US|37.45|-77.44
Greenville|PA|US|41.4|-80.39
Branford Center|CT|US|41.28|-72.82
Carterville|IL|US|37.76|-89.08
Meraux|LA|US|29.93|-89.92
Charleston|MO|US|36.92|-89.35
Manasquan|NJ|US|40.13|-74.05
Saint Helena|CA|US|38.51|-122.47
Ada|OH|US|40.77|-83.82
Lucerne Valley|CA|US|34.44|-116.97
Warren|AR|US|33.61|-92.06
Shady Side|MD|US|38.84|-76.51
Volney|NY|US|43.34|-76.36
Fruitridge Pocket|CA|US|38.53|-121.46
The Village of Indian Hill|OH|US|39.18|-84.34
Lake Mills|WI|US|43.08|-88.91
Ranchettes|WY|US|41.22|-104.79
Tierra Buena|CA|US|39.15|-121.67
DeFuniak Springs|FL|US|30.72|-86.12
Union|KY|US|38.95|-84.68
Spring Ridge|MD|US|39.4|-77.35
Windcrest|TX|US|29.52|-98.38
Edna|TX|US|28.98|-96.65
Belvedere|SC|US|33.53|-81.94
Selinsgrove|PA|US|40.8|-76.86
Tellico Village|TN|US|35.68|-84.26
Locust Grove|GA|US|33.35|-84.11
Boiling Spring Lakes|NC|US|34.03|-78.07
Washingtonville|NY|US|41.43|-74.17
Cheshire Village|CT|US|41.5|-72.9
Hollidaysburg|PA|US|40.43|-78.39
Fort Wright|KY|US|39.05|-84.53
Cheraw|SC|US|34.7|-79.88
Chadron|NE|US|42.83|-103
Lewisburg|PA|US|40.96|-76.88
McCordsville|IN|US|39.91|-85.92
Belding|MI|US|43.1|-85.23
Henryetta|OK|US|35.44|-95.98
Luling|TX|US|29.68|-97.65
Milton Center|MA|US|42.25|-71.08
Vine Grove|KY|US|37.81|-85.98
Prairie du Chien|WI|US|43.05|-91.14
Malone|NY|US|44.85|-74.29
Gustine|CA|US|37.26|-121
Jamestown|RI|US|41.5|-71.37
Sandersville|GA|US|32.98|-82.81
Moosic|PA|US|41.35|-75.74
Holdenville|OK|US|35.08|-96.4
Bay Harbor|MI|US|45.36|-85.08
Elburn|IL|US|41.89|-88.47
Southold|NY|US|41.06|-72.43
Granville|OH|US|40.07|-82.52
Centerville|IA|US|42.09|-93.94
Kuli'ou'ou|HI|US|21.29|-157.74
Clover|SC|US|35.11|-81.23
Trooper|PA|US|40.15|-75.4
South Oroville|CA|US|39.48|-121.54
Solvang|CA|US|34.6|-120.14
McRae|GA|US|32.07|-82.9
Taos|NM|US|36.41|-105.57
Oceanport|NJ|US|40.32|-74.02
Beardstown|IL|US|40.02|-90.42
Groveport|OH|US|39.88|-82.88
Grayson Valley|AL|US|33.65|-86.64
Sinton|TX|US|28.04|-97.51
Augusta|WV|US|39.3|-78.64
Citra|FL|US|29.41|-82.11
Loudon|TN|US|35.73|-84.33
South Apopka|FL|US|28.66|-81.51
Mount Carmel|PA|US|40.8|-76.41
Center|TX|US|31.51|-96.42
Hutchins|TX|US|32.65|-96.71
Hillsboro|IL|US|39.16|-89.5
White Rock|NM|US|35.83|-106.2
Gulf Park Estates|MS|US|30.39|-88.76
Petoskey|MI|US|45.37|-84.96
Cumming|GA|US|34.21|-84.14
Palmview|TX|US|26.23|-98.37
South Tucson|AZ|US|32.2|-110.97
Belmar|NJ|US|40.18|-74.02
Spring Grove|IL|US|42.44|-88.24
Rupert|ID|US|42.62|-113.68
Waynesboro|GA|US|33.09|-82.02
Sharon Hill|PA|US|39.91|-75.27
Marigot||MF|18.07|-63.08
Spencer|MA|US|42.24|-71.99
Ocean Shores|WA|US|46.97|-124.16
Penn Wynne|PA|US|39.99|-75.28
Belle Fourche|SD|US|44.67|-103.85
Forest|MS|US|32.36|-89.47
Willow Springs|IL|US|41.74|-87.86
Wilmington|IL|US|41.31|-88.15
Bright|IN|US|39.22|-84.86
New Carlisle|OH|US|39.94|-84.03
Lindale|TX|US|32.52|-95.41
Blauvelt|NY|US|41.06|-73.96
South Gate Ridge|FL|US|27.29|-82.5
Kingston Estates|NJ|US|39.92|-74.99
Tenleytown|DC|US|38.95|-77.08
Moores Mill|AL|US|34.84|-86.52
Barnhart|MO|US|38.34|-90.39
Deer Park|OH|US|39.21|-84.39
Marlin|TX|US|31.31|-96.9
West Modesto|CA|US|37.62|-121.04
Nazareth|PA|US|40.74|-75.31
Lebanon|KY|US|37.57|-85.25
Oreland|PA|US|40.12|-75.18
Edgemoor|DE|US|39.75|-75.5
Hopkinton|NH|US|43.19|-71.68
Corona de Tucson|AZ|US|31.97|-110.78
Lake Bluff|IL|US|42.28|-87.83
Wailea-Makena|HI|US|20.66|-156.43
Douglass Hills|KY|US|38.24|-85.55
West Rancho Dominguez|CA|US|33.89|-118.27
Snowflake|AZ|US|34.51|-110.08
Fountainhead-Orchard Hills|MD|US|39.69|-77.72
Carlinville|IL|US|39.28|-89.88
Briar|TX|US|33|-97.54
Westville|IN|US|41.54|-86.9
Richland|NY|US|43.57|-76.05
Barberton|WA|US|45.69|-122.6
Covington|VA|US|37.79|-79.99
Sharon|MA|US|42.12|-71.18
Buckhannon|WV|US|38.99|-80.23
Gardnerville|NV|US|38.94|-119.75
Mena|AR|US|34.59|-94.24
Morristown|VT|US|44.56|-72.62
Pevely|MO|US|38.28|-90.4
Rib Mountain|WI|US|44.91|-89.68
Hingham|MA|US|42.24|-70.89
Monaca|PA|US|40.69|-80.27
Highland|NY|US|41.72|-73.96
Vinita|OK|US|36.64|-95.15
Ashburnham|MA|US|42.64|-71.91
Coldstream Homestead Montebello|MD|US|39.32|-76.6
Pontoon Beach|IL|US|38.73|-90.08
Bath|NY|US|42.34|-77.32
Tequesta|FL|US|26.96|-80.09
Ashton-Sandy Spring|MD|US|39.15|-77.01
Indian Hills|NV|US|39.09|-119.78
Zeeland|MI|US|42.81|-86.02
Foxborough|MA|US|42.07|-71.25
Lakeview|NY|US|42.43|-75.87
Pawcatuck|CT|US|41.38|-71.83
Silver Lakes|CA|US|34.75|-117.34
Marlow Heights|MD|US|38.83|-76.95
Long Beach|NC|US|33.91|-78.12
Rusk|TX|US|31.8|-95.15
Sterling|AK|US|60.54|-150.76
Big Stone Gap|VA|US|36.88|-82.75
Potomac Mills|VA|US|38.65|-77.29
Snyderville|UT|US|40.69|-111.54
Loch Raven|MD|US|39.36|-76.58
Bellaire|NY|US|40.71|-73.75
Dresher|PA|US|40.14|-75.17
Rockdale|TX|US|30.66|-97
Okeechobee|FL|US|27.24|-80.83
Pana|IL|US|39.39|-89.08
Atlanta|TX|US|33.11|-94.16
Keyes|CA|US|37.56|-120.92
Finderne|NJ|US|40.56|-74.58
Silver Lake|NC|US|34.15|-77.91
Gardiner|ME|US|44.23|-69.78
Exeter|PA|US|41.32|-75.82
Richmond|MO|US|39.28|-93.98
Union Beach|NJ|US|40.45|-74.18
Pelham Manor|NY|US|40.9|-73.81
Milton|WI|US|42.78|-88.94
West Hills|NY|US|40.82|-73.43
Kensington|PA|US|39.99|-75.13
Breckenridge|TX|US|32.76|-98.9
Coraopolis|PA|US|40.52|-80.17
Whiteville|NC|US|34.34|-78.7
Woods Creek|WA|US|47.88|-121.9
Salamanca|NY|US|42.16|-78.72
Gray|LA|US|29.7|-90.79
Wadesboro|NC|US|34.97|-80.08
West Samoset|FL|US|27.47|-82.56
Three Points|AZ|US|32.08|-111.31
Hidden Valley Lake|CA|US|38.81|-122.56
Ala Moana|HI|US|21.29|-157.84
Combee Settlement|FL|US|28.06|-81.91
Alma|AR|US|35.48|-94.22
Weldon Spring|MO|US|38.71|-90.69
Palmview South|TX|US|26.22|-98.38
Paoli|PA|US|40.04|-75.48
Jan-Phyl Village|FL|US|28.01|-81.77
Falcon Heights|MN|US|44.99|-93.17
Greenwood|MO|US|38.85|-94.34
Wayne|NE|US|42.23|-97.02
Swartz Creek|MI|US|42.96|-83.83
Greenacres|CA|US|35.38|-119.11
Crozet|VA|US|38.07|-78.7
Newberry|FL|US|29.65|-82.61
Naples Manor|FL|US|26.09|-81.73
Fussels Corner|FL|US|28.05|-81.86
Holdrege|NE|US|40.44|-99.37
Woodside|CA|US|37.43|-122.25
Nephi|UT|US|39.71|-111.84
Lake Fenton|MI|US|42.85|-83.71
Shippensburg|PA|US|40.05|-77.52
Kenosha Streetcar|WI|US|42.59|-87.81
Corcoran|MN|US|45.1|-93.55
Wappingers Falls|NY|US|41.6|-73.91
Gateway|AK|US|61.57|-149.24
Ocean City|FL|US|30.44|-86.61
Brady|TX|US|31.14|-99.34
Helena|AR|US|34.53|-90.59
Bessemer City|NC|US|35.28|-81.28
Eastham|MA|US|41.83|-69.97
Nurillo|TX|US|26.27|-98.12
Marbletown|NY|US|41.88|-74.11
Alton North (historical)|TX|US|26.3|-98.3
Grissom Air Force Base|IN|US|40.66|-86.15
Duquesne|PA|US|40.38|-79.86
Webster|NY|US|43.21|-77.43
Marksville|LA|US|31.13|-92.07
Litchfield Park|AZ|US|33.49|-112.36
Morris Plains|NJ|US|40.82|-74.48
Edgerton|WI|US|42.84|-89.07
Waipi'o Acres|HI|US|21.46|-158.01
Paola|KS|US|38.57|-94.88
Jeanerette|LA|US|29.91|-91.66
Old Bethpage|NY|US|40.76|-73.45
West Loch Estates|HI|US|21.37|-158.02
Lake Forest|FL|US|25.98|-80.18
Glencoe|MN|US|44.77|-94.15
Hamlin|NY|US|43.3|-77.92
Minot Air Force Base|ND|US|48.42|-101.34
Rochelle Park|NJ|US|40.91|-74.08
Durham|CA|US|39.65|-121.8
Hightstown|NJ|US|40.27|-74.52
Anthony|TX|US|32|-106.61
West Side Highway|WA|US|46.18|-122.92
Adams|MA|US|42.62|-73.12
Fairview|NY|US|41.72|-73.92
Mayflower Village|CA|US|34.12|-118.01
Homer|AK|US|59.64|-151.55
Crystal Lake|FL|US|28.04|-81.91
Fellsmere|FL|US|27.77|-80.6
Waterville|OH|US|41.5|-83.72
Century City|CA|US|34.06|-118.42
West Bountiful|UT|US|40.89|-111.9
Monticello|IL|US|40.03|-88.57
Williamston|NC|US|35.85|-77.06
Centerport|NY|US|40.89|-73.38
Harris Hill|NY|US|42.96|-78.68
Richlands|VA|US|37.09|-81.79
Germantown|OH|US|39.63|-84.37
Pass Christian|MS|US|30.32|-89.25
Wyndmoor|PA|US|40.08|-75.19
Harrisburg|SD|US|43.43|-96.7
Mount Vernon|MD|US|39.3|-76.62
Emporia|VA|US|36.69|-77.54
Lyndon|VT|US|44.51|-72.01
Wellston|OH|US|39.12|-82.53
Elverta|CA|US|38.71|-121.46
Glendive|MT|US|47.11|-104.71
Coal City|IL|US|41.29|-88.29
Rancho Murieta|CA|US|38.5|-121.09
Fort Myers Shores|FL|US|26.71|-81.75
Canal Fulton|OH|US|40.89|-81.6
'Aiea Heights|HI|US|21.39|-157.92
Chester|SC|US|34.7|-81.21
Saint Clair|MI|US|42.82|-82.49
Northfield|IL|US|42.1|-87.78
Lake Murray of Richland|SC|US|34.12|-81.26
Southampton|MA|US|42.23|-72.73
Robbins|IL|US|41.64|-87.7
Lake Alfred|FL|US|28.09|-81.72
VA Boston Healthcare System, Brockton Campus|MA|US|42.37|-71.06
Mascotte|FL|US|28.58|-81.89
Red Oak|IA|US|41.01|-95.23
Hawkinsville|GA|US|32.28|-83.47
Wake Village|TX|US|33.43|-94.11
Iola|KS|US|37.92|-95.4
Algona|IA|US|43.07|-94.23
Turner|ME|US|44.26|-70.26
Anamosa|IA|US|42.11|-91.29
Northwood|OH|US|40.47|-83.73
Cumberland|IN|US|39.78|-85.96
El Granada|CA|US|37.5|-122.47
Salida|CO|US|38.53|-106
Isanti|MN|US|45.49|-93.25
Vail|CO|US|39.64|-106.37
Nashville|NC|US|35.97|-77.97
Somerdale|NJ|US|39.84|-75.02
Cameron|TX|US|30.85|-96.98
Brush|CO|US|40.26|-103.62
Chamberlayne|VA|US|37.63|-77.43
Comstock Northwest|MI|US|42.32|-85.52
Willard|MO|US|37.31|-93.43
La Habra Heights|CA|US|33.96|-117.95
Waimanalo|HI|US|21.35|-157.72
Lebanon|ME|US|43.39|-70.85
Fort Washington|PA|US|40.14|-75.21
Los Chavez|NM|US|34.73|-106.76
Connell|WA|US|46.66|-118.86
North Hills|NY|US|40.78|-73.68
Stroudsburg|PA|US|40.99|-75.19
Batesburg-Leesville|SC|US|33.91|-81.54
Williamson|AZ|US|34.69|-112.54
Patterson Park Neighborhood|MD|US|39.29|-76.57
Academy Garden|PA|US|40.06|-75
Macon|MO|US|39.74|-92.47
Brewton|AL|US|31.11|-87.07
Dayton|KY|US|39.11|-84.47
New Holland|PA|US|40.1|-76.09
Glasgow Village|MO|US|38.75|-90.2
Mount Carmel|TN|US|36.55|-82.66
Rockwood|TN|US|35.87|-84.68
Sayre|PA|US|41.98|-76.52
Berlin|WI|US|43.97|-88.94
Clarinda|IA|US|40.74|-95.04
South Hooksett|NH|US|43.03|-71.44
Colby|KS|US|39.4|-101.05
Manchester|WA|US|47.56|-122.55
Paxtonia|PA|US|40.32|-76.79
Sherwood Manor|CT|US|42.01|-72.56
Manchester|MD|US|39.66|-76.88
White City|UT|US|40.57|-111.86
Winfield|IN|US|41.41|-87.28
Uhrichsville|OH|US|40.39|-81.35
Englewood Cliffs|NJ|US|40.89|-73.95
Basehor|KS|US|39.14|-94.94
Brownsfield|LA|US|30.55|-91.12
Diboll|TX|US|31.19|-94.78
Eastwick|PA|US|39.89|-75.24
Starke|FL|US|29.94|-82.11
Aberdeen|MS|US|33.83|-88.54
Goshen|NY|US|41.4|-74.32
Strawberry|CA|US|37.9|-122.51
Winston|OR|US|43.12|-123.41
Progress Village|FL|US|27.9|-82.36
Lochbuie|CO|US|40.01|-104.72
New Gloucester|ME|US|43.96|-70.28
Islip Terrace|NY|US|40.74|-73.19
Titusville|PA|US|41.63|-79.67
Bowling Green|MO|US|39.34|-91.2
Hidden Valley|IN|US|39.16|-84.84
Terryville|CT|US|41.68|-73.01
Huntertown|IN|US|41.23|-85.17
Timber Pines|FL|US|28.47|-82.6
Pinckneyville|IL|US|38.08|-89.38
Oxford|PA|US|39.79|-75.98
Fox Chapel|PA|US|40.51|-79.88
New Castle|DE|US|39.66|-75.56
Palermo|CA|US|39.44|-121.54
Suncook|NH|US|43.13|-71.45
Mendon|MA|US|42.11|-71.55
Eureka|IL|US|40.72|-89.27
Perezville|TX|US|26.22|-98.4
Ballston Spa|NY|US|43|-73.85
Waynesville|MO|US|37.83|-92.2
Summit|AZ|US|32.07|-110.95
Worland|WY|US|44.02|-107.96
Berryville|AR|US|36.36|-93.57
Manchester-by-the-Sea|MA|US|42.58|-70.77
Stapleton|NY|US|40.63|-74.08
Old Fig Garden|CA|US|36.8|-119.81
Waldon|CA|US|37.93|-122.06
Contra Costa Centre|CA|US|37.93|-122.06
Media|PA|US|39.92|-75.39
Wilton|CA|US|38.41|-121.27
Dowsett Highlands|HI|US|21.34|-157.83
Waterford|WI|US|42.76|-88.21
Ripley|MS|US|34.73|-88.95
Tyrone|PA|US|40.67|-78.24
Highwood|IL|US|42.2|-87.81
Morris|MN|US|45.59|-95.91
Fairport|NY|US|43.1|-77.44
Zimmerman|MN|US|45.44|-93.59
Post|TX|US|33.19|-101.38
Wind Lake|WI|US|42.83|-88.16
Hazard|KY|US|37.25|-83.19
Cave Creek|AZ|US|33.83|-111.95
Stokesdale|NC|US|36.24|-79.98
Cape May Court House|NJ|US|39.08|-74.82
Nassau Village-Ratliff|FL|US|30.51|-81.81
Manitou Springs|CO|US|38.86|-104.92
Watertown Square|MA|US|42.37|-71.18
Dacula|GA|US|33.99|-83.9
Calistoga|CA|US|38.58|-122.58
Rothschild|WI|US|44.89|-89.62
Byron|MN|US|44.03|-92.65
Pumphrey|MD|US|39.22|-76.64
Monticello|IN|US|40.75|-86.76
Yarmouth Port|MA|US|41.7|-70.25
Savin Hill|MA|US|42.31|-71.06
Weiser|ID|US|44.25|-116.97
Adel|GA|US|31.14|-83.42
Spring Valley|IL|US|41.33|-89.2
Poland|ME|US|44.06|-70.39
Lehighton|PA|US|40.83|-75.71
Eucalyptus Hills|CA|US|32.88|-116.95
South Gastonia|NC|US|35.22|-81.21
New Hempstead|NY|US|41.15|-74.03
Palmerton|PA|US|40.8|-75.61
Cross Country|MD|US|39.37|-76.7
Edgewater|CO|US|39.75|-105.06
Hardeeville|SC|US|32.29|-81.08
Smiths Station|AL|US|32.54|-85.1
Mount Arlington|NJ|US|40.93|-74.63
Carpenter|PA|US|40.05|-75.2
East Kapolei|HI|US|21.36|-158.05
Newmarket|NH|US|43.08|-70.94
Greenbrier|AR|US|35.23|-92.39
McKenzie|TN|US|36.13|-88.52
Silver Springs|NV|US|39.42|-119.22
Pecan Plantation|TX|US|32.36|-97.68
Williamsburg|KY|US|36.74|-84.16
Hartsdale|NY|US|41.02|-73.8
Jonesborough|TN|US|36.29|-82.47
Asbury|IA|US|42.51|-90.75
Indian Wells|CA|US|33.72|-116.34
Cahaba Heights|AL|US|33.46|-86.73
Terrell Hills|TX|US|29.47|-98.45
Collegeville|PA|US|40.19|-75.45
Boulevard Park|WA|US|47.51|-122.32
Eastman|GA|US|32.2|-83.18
Linton|IN|US|39.03|-87.17
New Ipswich|NH|US|42.75|-71.85
South Haven|IN|US|41.54|-87.14
Warrenton|OR|US|46.17|-123.92
Harvest|AL|US|34.86|-86.75
Harpswell Center|ME|US|43.8|-69.98
Bliss Corner|MA|US|41.61|-70.94
Bluefield|VA|US|37.25|-81.27
Saint Paul Park|MN|US|44.84|-92.99
Walterboro|SC|US|32.91|-80.67
Bellevue|MA|US|42.29|-71.15
Rye|NH|US|43.01|-70.77
Big Flats|NY|US|42.14|-76.94
Zephyrhills South|FL|US|28.21|-82.19
Saranac Lake|NY|US|44.33|-74.13
Creve Coeur|IL|US|40.65|-89.59
Turtle Creek|PA|US|40.41|-79.83
Schlusser|PA|US|40.24|-77.18
Shillington|PA|US|40.31|-75.97
Ivy City|DC|US|38.91|-76.98
Reservoir Hill|MD|US|39.31|-76.63
Hampden|MA|US|42.06|-72.41
West Clarkston-Highland|WA|US|46.4|-117.06
Delhi Hills|OH|US|39.09|-84.61
Carlisle|OH|US|39.58|-84.32
Fairfield|IL|US|42.22|-88.06
Williamsville|NY|US|42.96|-78.74
Palm Springs North|FL|US|25.94|-80.33
Glenwood|IA|US|41.05|-95.74
East Moriches|NY|US|40.81|-72.76
Tonganoxie|KS|US|39.11|-95.09
Woodstock|VA|US|38.88|-78.51
Keyser|WV|US|39.44|-78.97
Folkston|GA|US|30.83|-82.01
Grove Hall|MA|US|42.31|-71.07
Scituate|MA|US|42.2|-70.73
Forked River|NJ|US|39.84|-74.19
Dove Valley|CO|US|39.58|-104.83
Pea Ridge|AR|US|36.45|-94.12
De Witt|IA|US|41.82|-90.54
Chester|NH|US|42.96|-71.26
Moab|UT|US|38.57|-109.55
Sunset Beach-Pupukea|HI|US|21.66|-158.05
Tracyton|WA|US|47.61|-122.66
Grosse Pointe|MI|US|42.39|-82.91
Paulden|AZ|US|34.89|-112.47
Schuylkill Haven|PA|US|40.63|-76.17
Evansville|WI|US|42.78|-89.3
Eaton Rapids|MI|US|42.51|-84.66
Hugo|OK|US|34.01|-95.51
Midfield|AL|US|33.46|-86.91
River Park|FL|US|27.31|-80.35
Crossett|AR|US|33.13|-91.96
Hoopeston|IL|US|40.47|-87.67
Pine Island Ridge|FL|US|26.09|-80.27
Concordia|KS|US|39.57|-97.66
New Martinsville|WV|US|39.64|-80.86
Floral City|FL|US|28.75|-82.3
Dumfries|VA|US|38.57|-77.33
Montevideo|MN|US|44.95|-95.72
Fruitland|MD|US|38.32|-75.62
Kennebunk|ME|US|43.38|-70.54
Lone Grove|OK|US|34.18|-97.26
Marion|MA|US|41.7|-70.76
Big Bear Lake|CA|US|34.24|-116.91
Preston|ID|US|42.1|-111.88
Oak Park|IN|US|38.31|-85.7
Grambling|LA|US|32.53|-92.71
Slinger|WI|US|43.33|-88.29
Bisbee|AZ|US|31.45|-109.93
Chelsea|MI|US|42.32|-84.02
Berkeley|IL|US|41.89|-87.9
Bangor|PA|US|40.87|-75.21
Grandwood Park|IL|US|42.39|-87.99
Saranap|CA|US|37.88|-122.08
Poolesville|MD|US|39.15|-77.42
Hutchinson Island South|FL|US|27.3|-80.22
Camp Pendleton North|CA|US|33.31|-117.32
Creswell|OR|US|43.92|-123.02
Rockingham|VT|US|43.19|-72.49
Glendale|CO|US|39.7|-104.93
Vaduz|Vaduz|LI|47.14|9.52
Nelsonville|OH|US|39.46|-82.23
Coolidge Corner|MA|US|42.35|-71.12
Orchard Homes|MT|US|46.86|-114.05
Hilmar-Irwin|CA|US|37.4|-120.85
Genoa|IL|US|42.1|-88.69
Williams|CA|US|39.15|-122.15
South Highpoint|FL|US|27.92|-82.71
Iowa Falls|IA|US|42.52|-93.25
Mont Belvieu|TX|US|29.85|-94.89
Springfield|MI|US|42.33|-85.24
Abbeville|SC|US|34.18|-82.38
Kayenta|AZ|US|36.73|-110.25
Wailua Homesteads|HI|US|22.07|-159.38
Gilmer|TX|US|32.73|-94.94
Prairie Grove|AR|US|35.98|-94.32
Muleshoe|TX|US|34.23|-102.72
Saint Clairsville|OH|US|40.08|-80.9
Sunset|UT|US|41.14|-112.03
Albertson|NY|US|40.77|-73.64
White Hall|AR|US|34.27|-92.09
Alva|OK|US|36.8|-98.67
Odessa|MO|US|39|-93.95
Chackbay|LA|US|29.88|-90.8
Montrose-Ghent|OH|US|41.15|-81.64
Winterset|IA|US|41.33|-94.01
Monticello|LA|US|30.49|-91.05
Livingston|TX|US|30.71|-94.93
Bear Valley Springs|CA|US|35.16|-118.63
Brookhaven|WV|US|39.61|-79.9
Layhill|MD|US|39.09|-77.04
Mechanicville|NY|US|42.9|-73.69
Central|SC|US|34.72|-82.78
Pauoa|HI|US|21.32|-157.84
Mount Pleasant|PA|US|40.06|-75.18
Northumberland|NY|US|43.13|-73.59
Birdsboro|PA|US|40.26|-75.8
Flat River|MO|US|37.85|-90.52
Glencoe|AL|US|33.96|-85.93
Sunnyslope|CA|US|34.01|-117.43
Bret Harte|CA|US|37.6|-121.01
Pennsylvania Avenue SE|DC|US|38.87|-76.96
Mocksville|NC|US|35.89|-80.56
Lakehills|TX|US|29.6|-98.94
Wildwood|NJ|US|38.99|-74.81
Grafton|WV|US|39.34|-80.02
Vinton|IA|US|42.17|-92.02
Chardon|OH|US|41.61|-81.15
Stansbury park|UT|US|40.64|-112.3
Tipton|IN|US|40.28|-86.04
Daleville|AL|US|31.31|-85.71
Poplar Grove|IL|US|42.37|-88.82
Maplewood|WA|US|47.4|-122.56
Tichigan|WI|US|42.83|-88.2
Kaser|NY|US|41.12|-74.07
Kings Point|NY|US|40.82|-73.74
Port Allen|LA|US|30.45|-91.21
Wheatley Heights|NY|US|40.76|-73.37
Pupukea|HI|US|21.65|-158.06
Robinson Heights|HI|US|21.38|-158.03
Bowie|TX|US|33.56|-97.85
Tara Hills|CA|US|37.99|-122.32
Dos Palos|CA|US|36.99|-120.63
Homestead Meadows North|TX|US|31.85|-106.17
Farrington|HI|US|21.33|-157.87
Milton Village|MA|US|42.27|-71.07
New Haven|MI|US|43.09|-84.15
Brookshire|TX|US|29.79|-95.95
Sugarcreek|PA|US|41.42|-79.88
Carmi|IL|US|38.09|-88.16
Shaw Heights|CO|US|39.85|-105.04
Olyphant|PA|US|41.47|-75.6
Savannah|MO|US|39.94|-94.83
Dunlap|TN|US|35.37|-85.39
Briar Chapel|NC|US|35.82|-79.12
Byron|GA|US|32.65|-83.76
Sawmills|NC|US|35.82|-81.47
Pound Ridge|NY|US|41.21|-73.57
Piedmont|SC|US|34.7|-82.46
South Bay|FL|US|26.66|-80.72
Colona|IL|US|41.48|-90.35
El Cerrito Corona|CA|US|33.84|-117.52
Turpin Hills|OH|US|39.11|-84.38
Springhill|LA|US|33.01|-93.47
Perry|OK|US|36.29|-97.29
Sulphur|OK|US|34.51|-96.97
Sunbury|OH|US|40.24|-82.86
Sparta|TN|US|35.93|-85.46
Milan|IL|US|41.45|-90.57
Dayton|MN|US|45.24|-93.51
Chestertown|MD|US|39.21|-76.07
Bolivar|TN|US|35.26|-88.99
Columbia Falls|MT|US|48.37|-114.18
Bridgeville|PA|US|40.36|-80.11
Wahneta|FL|US|27.95|-81.73
Doffing|TX|US|26.27|-98.39
Camilla|GA|US|31.23|-84.21
Zapata|TX|US|26.91|-99.27
Auburn|NH|US|43|-71.35
Enchanted Lake|HI|US|21.38|-157.74
Sheldon|IA|US|43.18|-95.86
Fruitland|ID|US|44.01|-116.92
Glennville|GA|US|31.94|-81.93
Summerside|OH|US|39.1|-84.29
Monee|IL|US|41.42|-87.74
Buellton|CA|US|34.61|-120.19
South Pasadena|FL|US|27.76|-82.74
North Scituate|MA|US|42.22|-70.79
Kensington|CA|US|37.91|-122.28
Deschutes River Woods|OR|US|43.99|-121.36
Lake Norman of Catawba|NC|US|35.59|-80.96
Manchester|IA|US|42.48|-91.46
Paris|ME|US|44.26|-70.5
Kenneth City|FL|US|27.82|-82.72
Granite Shoals|TX|US|30.59|-98.38
Allegan|MI|US|42.53|-85.86
Watseka|IL|US|40.78|-87.74
Cold Spring Harbor|NY|US|40.87|-73.46
New Burlington|OH|US|39.26|-84.56
Kingsford|MI|US|45.79|-88.07
North Harford Road|MD|US|39.37|-76.55
Wapato|WA|US|46.45|-120.42
Berlin|MD|US|38.32|-75.22
Giddings|TX|US|30.18|-96.94
McGregor|TX|US|31.44|-97.41
Fort Pierce South|FL|US|27.41|-80.35
Warm Mineral Springs|FL|US|27.06|-82.26
Redwood Falls|MN|US|44.54|-95.12
Apple Valley|OH|US|40.44|-82.35
Fells Point|MD|US|39.28|-76.59
Howard Park|MD|US|39.33|-76.69
Punahou|HI|US|21.3|-157.83
Blaine|WA|US|48.99|-122.75
Ayden|NC|US|35.47|-77.42
Hampton|MD|US|39.42|-76.58
Eagleton Village|TN|US|35.8|-83.93
Shanor-Northvue|PA|US|40.91|-79.92
Demarest|NJ|US|40.96|-73.96
Northfield|NH|US|43.43|-71.59
Alexandria|IN|US|40.26|-85.68
Samsula-Spruce Creek|FL|US|29.05|-81.06
Childersburg|AL|US|33.28|-86.35
Gretna|NE|US|41.14|-96.24
Newton Corner|MA|US|42.36|-71.2
Readville|MA|US|42.24|-71.14
Morganville|NJ|US|40.38|-74.24
Lemmon Valley|NV|US|39.64|-119.84
Forest Hills|TN|US|36.07|-86.84
Mathis|TX|US|28.09|-97.83
Waterloo|NY|US|42.9|-76.86
Moultonborough|NH|US|43.75|-71.4
Bolton Hill|MD|US|39.31|-76.63
Thiells|NY|US|41.21|-74.02
Vandergrift|PA|US|40.6|-79.56
Rainsville|AL|US|34.49|-85.85
Fairwood|MD|US|38.96|-76.78
Cherokee|IA|US|42.75|-95.55
Kutztown|PA|US|40.52|-75.78
Centreville|IL|US|38.58|-90.13
Lake City|MN|US|44.45|-92.27
Frankenmuth|MI|US|43.33|-83.74
Sea Cliff|NY|US|40.85|-73.64
Tucumcari|NM|US|35.17|-103.73
Valparaiso|FL|US|30.51|-86.5
Shenandoah|IA|US|40.77|-95.37
Munroe Falls|OH|US|41.14|-81.44
Holbrook|AZ|US|34.9|-110.16
Staunton|IL|US|39.01|-89.79
Spirit Lake|IA|US|43.42|-95.1
Port Isabel|TX|US|26.07|-97.21
Highland|MA|US|42.29|-71.16
Penn Yan|NY|US|42.66|-77.05
West Salem|WI|US|43.9|-91.08
Richland Center|WI|US|43.33|-90.39
Glen Willow|PA|US|40.03|-75.23
Dellwood|MO|US|38.75|-90.29
West Sayville|NY|US|40.73|-73.1
Bryn Mawr|PA|US|40.3|-80.09
Conklin|NY|US|42.03|-75.8
Saltillo|MS|US|34.38|-88.68
Shady Hollow|TX|US|30.16|-97.86
North Fond du Lac|WI|US|43.81|-88.48
Harlan|IA|US|41.65|-95.33
Houlton|ME|US|46.13|-67.84
Ironwood|MI|US|46.45|-90.17
Mendham|NJ|US|40.78|-74.6
San Marino|San Marino|SM|43.94|12.45
Cockburn Town||TC|21.46|-71.14
Longyearbyen|Svalbard|SJ|78.22|15.65
Stanley||FK|-51.69|-57.86
The Valley|The Valley|AI|18.22|-63.06
Ciudad de la Paz|Djibloho|GQ|1.59|10.82
Philipsburg||SX|18.03|-63.05
Flying Fish Cove||CX|-10.42|105.68
Mata-Utu|Uvea|WF|-13.28|-176.17
Yaren|Yaren District|NR|-0.55|166.93
Hagatna|Hagatna|GU|13.48|144.75
Hamilton|Hamilton city|BM|32.29|-64.78
Kingston||NF|-29.05|167.97
Vatican City||VA|41.9|12.45
Jamestown|Saint Helena|SH|-15.92|-5.72
Alofi||NU|-19.05|-169.92
West Island||CC|-12.16|96.82
Adamstown||PN|-25.07|-130.1
Port-aux-Francais|Kerguelen|TF|-49.35|70.22
Grytviken||GS|-54.28|-36.51
Plymouth|Saint Anthony|MS|16.71|-62.21
Ngerulmud|Melekeok|PW|7.5|134.62
`;
